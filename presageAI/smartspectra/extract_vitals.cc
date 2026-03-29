/**
 * SmartSpectra Vitals Extractor
 *
 * Processes video through the Presage SmartSpectra C++ SDK and outputs vitals as JSON.
 *
 * Two modes:
 *   1. Video file:    --input_video_path=/path/to/video.mp4
 *   2. Frame stream:  --file_stream_path=/path/to/frames_dir/
 *      (SDK reads numbered PNGs from a directory as they appear)
 *
 * In video mode, outputs a single JSON blob at the end.
 * In stream mode, outputs one JSON line per metrics callback (for real-time piping).
 *
 * Usage:
 *   ./extract_vitals --input_video_path=video.mp4 --api_key=YOUR_KEY
 *   ./extract_vitals --file_stream_path=/tmp/frames/ --api_key=YOUR_KEY --stream
 */

#include <string>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>
#include <cstdlib>
#include <vector>
#include <mutex>

#include <absl/status/status.h>
#include <absl/flags/flag.h>
#include <absl/flags/parse.h>
#include <absl/flags/usage.h>
#include <glog/logging.h>
#include <smartspectra/container/foreground_container.hpp>
#include <smartspectra/container/settings.hpp>
#include <smartspectra/video_source/camera/camera.hpp>
#include <google/protobuf/util/json_util.h>
#include <opencv2/opencv.hpp>

namespace spectra = presage::smartspectra;
namespace settings = presage::smartspectra::container::settings;

ABSL_FLAG(std::string, input_video_path, "", "Path to video file to process.");
ABSL_FLAG(std::string, file_stream_path, "", "Path to directory for frame-by-frame streaming.");
ABSL_FLAG(std::string, api_key, "", "Presage API key. Falls back to SMARTSPECTRA_API_KEY env var.");
ABSL_FLAG(bool, stream, false, "Stream mode: output one JSON line per metrics callback (for piping).");

struct MetricsCollector {
    std::mutex mtx;
    std::vector<std::string> snapshots;
    std::string latest_raw;
};

int main(int argc, char** argv) {
    google::InitGoogleLogging(argv[0]);
    FLAGS_alsologtostderr = true;

    absl::SetProgramUsageMessage(
        "Process video through SmartSpectra and output vitals as JSON.\n"
        "  Video file:   extract_vitals --input_video_path=video.mp4 --api_key=KEY\n"
        "  Frame stream: extract_vitals --file_stream_path=/tmp/frames/ --api_key=KEY --stream"
    );
    absl::ParseCommandLine(argc, argv);

    std::string video_path = absl::GetFlag(FLAGS_input_video_path);
    std::string stream_path = absl::GetFlag(FLAGS_file_stream_path);
    std::string api_key = absl::GetFlag(FLAGS_api_key);
    bool stream_mode = absl::GetFlag(FLAGS_stream);

    if (api_key.empty()) {
        const char* env_key = std::getenv("SMARTSPECTRA_API_KEY");
        if (env_key) api_key = env_key;
    }

    if (video_path.empty() && stream_path.empty()) {
        std::cerr << "{\"error\": \"Either --input_video_path or --file_stream_path is required\"}" << std::endl;
        return EXIT_FAILURE;
    }
    if (!video_path.empty() && !stream_path.empty()) {
        std::cerr << "{\"error\": \"Use --input_video_path or --file_stream_path, not both\"}" << std::endl;
        return EXIT_FAILURE;
    }
    if (api_key.empty()) {
        std::cerr << "{\"error\": \"API key required via --api_key or SMARTSPECTRA_API_KEY env var\"}" << std::endl;
        return EXIT_FAILURE;
    }
    if (!video_path.empty() && !std::filesystem::exists(video_path)) {
        std::cerr << "{\"error\": \"Video file not found: " << video_path << "\"}" << std::endl;
        return EXIT_FAILURE;
    }
    if (!stream_path.empty() && !std::filesystem::exists(stream_path)) {
        std::cerr << "{\"error\": \"Stream directory not found: " << stream_path << "\"}" << std::endl;
        return EXIT_FAILURE;
    }

    // If stream_path provided, auto-enable stream mode
    if (!stream_path.empty()) {
        stream_mode = true;
    }

    // Configure SDK
    settings::Settings<settings::OperationMode::Continuous, settings::IntegrationMode::Rest> s;

    if (!video_path.empty()) {
        s.video_source.input_video_path = video_path;
    } else {
        // File stream mode — SDK reads frames from directory as they appear
        // Frames should be named like: frame0000000000000.png (zero-padded microsecond timestamp)
        s.video_source.file_stream_path = stream_path + "frame0000000000000.png";
        s.video_source.erase_read_files = true;
        s.video_source.end_of_stream_filename = "end_of_stream";
        s.video_source.rescan_retry_delay_ms = 10;
    }

    s.headless = true;
    s.start_with_recording_on = true;
    s.interframe_delay_ms = 1;
    s.scale_input = true;
    s.binary_graph = true;
    s.enable_edge_metrics = false;
    s.verbosity_level = 1;
    s.continuous.preprocessed_data_buffer_duration_s = 0.2;
    s.integration.api_key = api_key;

    spectra::container::CpuContinuousRestForegroundContainer container(s);

    MetricsCollector collector;

    // Status callback
    auto status = container.SetOnStatusChange(
        [](presage::physiology::StatusValue sv) -> absl::Status {
            LOG(INFO) << "Status: " << presage::physiology::GetStatusDescription(sv.value());
            return absl::OkStatus();
        }
    );

    // Core metrics callback
    if (status.ok()) {
        status = container.SetOnCoreMetricsOutput(
            [&collector, stream_mode](
                const presage::physiology::MetricsBuffer& metrics,
                int64_t timestamp_ms
            ) {
                std::string json_str;
                google::protobuf::util::JsonPrintOptions options;
                options.add_whitespace = false;
                options.always_print_primitive_fields = true;
                google::protobuf::util::MessageToJsonString(metrics, &json_str, options);

                {
                    std::lock_guard<std::mutex> lock(collector.mtx);
                    collector.latest_raw = json_str;
                    collector.snapshots.push_back(json_str);
                }

                LOG(INFO) << "Core metrics at t=" << timestamp_ms << "ms (snapshot #"
                          << collector.snapshots.size() << ")";

                // In stream mode, emit each metrics update as a JSON line to stdout
                if (stream_mode) {
                    std::ostringstream line;
                    line << "{\"type\":\"vitals\",\"timestamp_ms\":" << timestamp_ms
                         << ",\"snapshot_index\":" << collector.snapshots.size()
                         << ",\"data\":" << json_str << "}";
                    // Use cout with flush for immediate piping
                    std::cout << line.str() << std::endl;
                    std::cout.flush();
                }

                return absl::OkStatus();
            }
        );
    }

    // Suppress video display
    if (status.ok()) {
        status = container.SetOnVideoOutput(
            [](cv::Mat& frame, int64_t timestamp) {
                return absl::OkStatus();
            }
        );
    }

    // Run pipeline
    if (status.ok()) { status = container.Initialize(); }
    if (status.ok()) { status = container.Run(); }

    if (!status.ok()) {
        std::cerr << "{\"error\": \"SDK error: " << status.message() << "\"}" << std::endl;
        return EXIT_FAILURE;
    }

    // Final output
    std::lock_guard<std::mutex> lock(collector.mtx);

    if (collector.snapshots.empty()) {
        if (stream_mode) {
            std::cout << "{\"type\":\"end\",\"status\":\"no_data\",\"error\":\"No metrics received.\"}" << std::endl;
        } else {
            std::cout << "{\"status\":\"no_data\",\"error\":\"No metrics received. Video may be too short or no face detected.\"}" << std::endl;
        }
        return 2;
    }

    if (stream_mode) {
        // Emit end-of-stream marker with summary
        std::cout << "{\"type\":\"end\",\"status\":\"complete\",\"snapshot_count\":"
                  << collector.snapshots.size() << "}" << std::endl;
    } else {
        // Batch mode — output all snapshots at end
        std::ostringstream out;
        out << "{";
        out << "\"status\":\"complete\",";
        out << "\"snapshot_count\":" << collector.snapshots.size() << ",";
        out << "\"all_snapshots\":[";
        for (size_t i = 0; i < collector.snapshots.size(); i++) {
            if (i > 0) out << ",";
            out << collector.snapshots[i];
        }
        out << "],";
        out << "\"latest\":" << collector.latest_raw;
        out << "}";
        std::cout << out.str() << std::endl;
    }

    return EXIT_SUCCESS;
}
