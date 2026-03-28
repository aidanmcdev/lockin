#include "webcam_mode.h"
#include "metrics_json.h"

#include <iostream>
#include <memory>
#include <atomic>
#include <csignal>

#include <smartspectra/container/settings.h>
#include <smartspectra/container/cpu_continuous_rest_foreground_container.h>
#include <opencv2/highgui.hpp>

namespace presage_api {

static std::atomic<bool> g_running{true};

static void signal_handler(int) {
    g_running = false;
}

int run_webcam_mode(const WebcamConfig& config) {
    std::signal(SIGINT, signal_handler);
    std::signal(SIGTERM, signal_handler);

    std::cout << "[webcam] Starting continuous capture on camera "
              << config.camera_index << std::endl;

    // Configure SDK settings
    container::settings::Settings<
        container::settings::OperationMode::Continuous,
        container::settings::IntegrationMode::Rest
    > settings;

    settings.video_source.device_index = config.camera_index;
    settings.video_source.capture_width_px = 1280;
    settings.video_source.capture_height_px = 720;
    settings.video_source.codec = "MJPG";
    settings.integration.api_key = config.api_key;
    settings.headless = config.headless;
    settings.enable_edge_metrics = true;
    settings.verbosity_level = 0;

    // Create the container
    auto ctr = std::make_unique<
        container::CpuContinuousRestForegroundContainer>(settings);

    // Core metrics callback (from cloud API, refined vitals)
    ctr->SetOnCoreMetricsOutput(
        [](const presage::physiology::MetricsBuffer& metrics,
           int64_t timestamp) -> absl::Status
        {
            auto json = metrics_to_json(metrics, timestamp);
            std::cout << "\n===== VITALS (Core) =====" << std::endl;
            if (json.contains("pulse_rate")) {
                std::cout << "  Pulse Rate:     "
                          << json["pulse_rate"].get<float>() << " bpm" << std::endl;
            }
            if (json.contains("pulse_rate_variability")) {
                std::cout << "  Pulse HRV:      "
                          << json["pulse_rate_variability"].get<float>() << std::endl;
            }
            if (json.contains("breathing_rate")) {
                std::cout << "  Breathing Rate: "
                          << json["breathing_rate"].get<float>() << " bpm" << std::endl;
            }
            std::cout << "  Timestamp:      " << json["timestamp"].get<std::string>()
                      << std::endl;
            std::cout << "=========================" << std::endl;
            return absl::OkStatus();
        });

    // Edge metrics callback (per-frame, local processing)
    ctr->SetOnEdgeMetricsOutput(
        [](const presage::physiology::Metrics& metrics) -> absl::Status
        {
            auto json = edge_metrics_to_json(metrics);
            if (json.contains("pulse_rate")) {
                std::cout << "[edge] pulse=" << json["pulse_rate"].get<float>();
            }
            if (json.contains("breathing_rate")) {
                std::cout << " breath=" << json["breathing_rate"].get<float>();
            }
            std::cout << std::endl;
            return absl::OkStatus();
        });

    // Video output callback (for display window if not headless)
    if (!config.headless) {
        ctr->SetOnVideoOutput(
            [](cv::Mat& frame, int64_t) -> absl::Status
            {
                cv::imshow("Presage Webcam", frame);
                int key = cv::waitKey(1);
                if (key == 'q' || key == 27) {  // q or ESC
                    g_running = false;
                }
                return absl::OkStatus();
            });
    }

    // Run the container (blocks until done)
    std::cout << "[webcam] Processing... Press 'q' or Ctrl+C to stop." << std::endl;
    auto status = ctr->Run();

    if (!status.ok()) {
        std::cerr << "[webcam] Error: " << status.message() << std::endl;
        return 1;
    }

    std::cout << "[webcam] Stopped." << std::endl;
    return 0;
}

} // namespace presage_api
