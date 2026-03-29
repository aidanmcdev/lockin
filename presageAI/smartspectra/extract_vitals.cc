/**
 * SmartSpectra Vitals Extractor
 *
 * Processes a video file through the Presage SmartSpectra C++ SDK
 * and outputs vitals as JSON to stdout.
 *
 * Usage:
 *   ./extract_vitals --input_video_path=/path/to/video.mp4 --api_key=YOUR_KEY
 *
 * Or with environment variable:
 *   export SMARTSPECTRA_API_KEY=YOUR_KEY
 *   ./extract_vitals --input_video_path=/path/to/video.mp4
 */

#include <string>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>
#include <cstdlib>

#include <absl/status/status.h>
#include <absl/flags/flag.h>
#include <absl/flags/parse.h>
#include <absl/flags/usage.h>
#include <glog/logging.h>
#include <smartspectra/container/foreground_container.hpp>
#include <smartspectra/container/settings.hpp>
#include <smartspectra/video_source/camera/camera.hpp>
#include <google/protobuf/util/json_util.h>

namespace spectra = presage::smartspectra;
namespace settings = presage::smartspectra::container::settings;
namespace vs = presage::smartspectra::video_source;
using DeviceType = presage::platform_independence::DeviceType;

ABSL_FLAG(std::string, input_video_path, "", "Path to video file to process.");
ABSL_FLAG(std::string, api_key, "", "Presage API key. Falls back to SMARTSPECTRA_API_KEY env var.");
ABSL_FLAG(std::string, output_file, "", "Optional: write JSON output to this file instead of stdout.");
ABSL_FLAG(bool, save_metrics_to_disk, true, "Save metrics JSON to output directory.");
ABSL_FLAG(std::string, output_directory, "/tmp/presage_out", "Directory for metrics output.");

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
    std::string output_dir = absl::GetFlag(FLAGS_output_directory);
    std::string output_file = absl::GetFlag(FLAGS_output_file);
    bool save_to_disk = absl::GetFlag(FLAGS_save_metrics_to_disk);

    // Fall back to env var for API key
    if (api_key.empty()) {
        const char* env_key = std::getenv("SMARTSPECTRA_API_KEY");
        if (env_key) {
            api_key = env_key;
        }
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

    // Use Continuous mode with REST integration to process the video file
    settings::Settings<settings::OperationMode::Continuous, settings::IntegrationMode::Rest> s{
        vs::VideoSourceSettings{
            /*camera_device_index=*/0,
            /*resolution_selection_mode=*/vs::ResolutionSelectionMode::Auto,
            /*capture_width_px=*/-1,
            /*capture_height_px=*/-1,
            /*resolution_range=*/presage::camera::CameraResolutionRange::Unspecified_EnumEnd,
            /*codec=*/presage::camera::CaptureCodec::MJPG,
            /*auto_lock=*/true,
            /*input_transform_mode=*/vs::InputTransformMode::Unspecified_EnumEnd,
            /*input_video_path=*/video_path,
            /*input_video_time_path=*/std::string(""),
        },
        settings::VideoSinkSettings{},
        /*headless=*/true,
        /*interframe_delay=*/1,
        /*start_with_recording_on=*/true,
        /*start_time_offset_ms=*/0,
        /*scale_input=*/true,
        /*binary_graph=*/true,
        /*enable_phasic_bp=*/std::optional<bool>(),
        /*enable_eda=*/std::optional<bool>(),
        /*enable_dense_facemesh_points=*/false,
        /*use_full_range_face_detection=*/std::optional<bool>(),
        /*use_full_pose_landmarks=*/std::optional<bool>(),
        /*enable_pose_landmark_segmentation=*/std::optional<bool>(),
        /*enable_micromotion=*/std::optional<bool>(),
        /*enable_edge_metrics=*/false,
        /*print_graph_contents=*/false,
        /*log_transfer_timing_info=*/false,
        /*verbosity=*/1,
        settings::ContinuousSettings{/*buffer_duration=*/0.2},
        settings::RestSettings{api_key}
    };

    spectra::container::CpuContinuousRestForegroundContainer container(s);

    // Collect the last metrics JSON we receive
    std::string last_metrics_json;

    auto status = container.SetOnStatusChange(
        [](presage::physiology::StatusValue sv) -> absl::Status {
            LOG(INFO) << "Status: " << presage::physiology::GetStatusDescription(sv.value());
            return absl::OkStatus();
        }
    );

    if (status.ok()) {
        status = container.SetOnCoreMetricsOutput(
            [&last_metrics_json, &save_to_disk, &output_dir](
                const presage::physiology::MetricsBuffer& metrics,
                int64_t timestamp_ms
            ) {
                google::protobuf::util::JsonPrintOptions options;
                options.add_whitespace = true;
                google::protobuf::util::MessageToJsonString(metrics, &last_metrics_json, options);

                LOG(INFO) << "Received metrics at timestamp " << timestamp_ms << "ms";

                if (save_to_disk) {
                    if (!std::filesystem::exists(output_dir)) {
                        std::filesystem::create_directories(output_dir);
                    }
                    std::string path = output_dir + "/metrics_" + std::to_string(timestamp_ms) + ".json";
                    std::ofstream f(path);
                    f << last_metrics_json;
                    f.close();
                }

                return absl::OkStatus();
            }
        );
    }

    if (status.ok()) { status = container.Initialize(); }
    if (status.ok()) { status = container.Run(); }

    if (!status.ok()) {
        std::cerr << "{\"error\": \"" << status.message() << "\"}" << std::endl;
        return EXIT_FAILURE;
    }

    // Output final metrics JSON to stdout
    if (last_metrics_json.empty()) {
        std::cout << "{\"status\": \"no_data\", \"error\": \"No metrics received from video\"}" << std::endl;
        return 2;
    }

    // Wrap in a result envelope
    std::cout << "{\"status\": \"complete\", \"metrics\": " << last_metrics_json << "}" << std::endl;

    if (!output_file.empty()) {
        std::ofstream f(output_file);
        f << "{\"status\": \"complete\", \"metrics\": " << last_metrics_json << "}";
        f.close();
        LOG(INFO) << "Results written to " << output_file;
    }

    return EXIT_SUCCESS;
}
