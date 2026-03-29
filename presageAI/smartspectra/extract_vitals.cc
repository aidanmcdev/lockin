/**
 * SmartSpectra Vitals Extractor
 *
 * Processes a video file through the Presage SmartSpectra C++ SDK
 * and outputs vitals as JSON to stdout.
 *
 * Uses Continuous mode with a large buffer to get meaningful vitals.
 * Extracts: pulse rate, breathing rate, HRV, stress index, face data.
 *
 * Usage:
 *   ./extract_vitals --input_video_path=/path/to/video.mp4 --api_key=YOUR_KEY
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
ABSL_FLAG(std::string, api_key, "", "Presage API key. Falls back to SMARTSPECTRA_API_KEY env var.");

// Holds metrics received during processing
struct MetricsCollector {
    std::mutex mtx;
    std::vector<std::string> snapshots;
    std::string latest_raw;
};

int main(int argc, char** argv) {
    google::InitGoogleLogging(argv[0]);
    FLAGS_alsologtostderr = true;

    absl::SetProgramUsageMessage(
        "Process a video file through SmartSpectra and output vitals as JSON.\n"
        "Usage: extract_vitals --input_video_path=video.mp4 --api_key=YOUR_KEY"
    );
    absl::ParseCommandLine(argc, argv);

    std::string video_path = absl::GetFlag(FLAGS_input_video_path);
    std::string api_key = absl::GetFlag(FLAGS_api_key);
    if (api_key.empty()) {
        const char* env_key = std::getenv("SMARTSPECTRA_API_KEY");
        if (env_key) api_key = env_key;
    }

    if (video_path.empty()) {
        std::cerr << "{\"error\": \"--input_video_path is required\"}" << std::endl;
        return EXIT_FAILURE;
    }
    if (api_key.empty()) {
        std::cerr << "{\"error\": \"API key required via --api_key or SMARTSPECTRA_API_KEY env var\"}" << std::endl;
        return EXIT_FAILURE;
    }
    if (!std::filesystem::exists(video_path)) {
        std::cerr << "{\"error\": \"Video file not found: " << video_path << "\"}" << std::endl;
        return EXIT_FAILURE;
    }

    // Continuous mode — small buffer sends data frequently, API accumulates
    settings::Settings<settings::OperationMode::Continuous, settings::IntegrationMode::Rest> s;
    s.video_source.input_video_path = video_path;
    s.headless = true;
    s.start_with_recording_on = true;
    s.interframe_delay_ms = 1;
    s.scale_input = true;
    s.binary_graph = true;
    s.enable_edge_metrics = false;
    s.verbosity_level = 1;

    // Small buffer — the API accumulates data across multiple uploads
    s.continuous.preprocessed_data_buffer_duration_s = 0.2;

    // REST integration
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

    // Core metrics callback — cloud-processed vitals
    if (status.ok()) {
        status = container.SetOnCoreMetricsOutput(
            [&collector](
                const presage::physiology::MetricsBuffer& metrics,
                int64_t timestamp_ms
            ) {
                std::lock_guard<std::mutex> lock(collector.mtx);

                collector.latest_raw.clear();
                google::protobuf::util::JsonPrintOptions options;
                options.add_whitespace = false;
                options.always_print_primitive_fields = true;
                google::protobuf::util::MessageToJsonString(metrics, &collector.latest_raw, options);

                collector.snapshots.push_back(collector.latest_raw);

                LOG(INFO) << "Core metrics received at t=" << timestamp_ms
                          << "ms (snapshot #" << collector.snapshots.size() << ")";

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

    // Build output JSON
    std::lock_guard<std::mutex> lock(collector.mtx);

    if (collector.snapshots.empty()) {
        std::cout << "{\"status\": \"no_data\", \"error\": \"No metrics received. Video may be too short or no face detected.\"}" << std::endl;
        return 2;
    }

    // Output all snapshots plus the latest
    std::ostringstream out;
    out << "{";
    out << "\"status\": \"complete\",";
    out << "\"snapshot_count\": " << collector.snapshots.size() << ",";
    out << "\"all_snapshots\": [";
    for (size_t i = 0; i < collector.snapshots.size(); i++) {
        if (i > 0) out << ",";
        out << collector.snapshots[i];
    }
    out << "],";
    out << "\"latest\": " << collector.latest_raw;
    out << "}";

    std::cout << out.str() << std::endl;
    return EXIT_SUCCESS;
}
