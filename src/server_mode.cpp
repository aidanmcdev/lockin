#include "server_mode.h"
#include "metrics_json.h"

#include <httplib.h>
#include <json.hpp>

#include <iostream>
#include <fstream>
#include <mutex>
#include <condition_variable>
#include <filesystem>
#include <memory>
#include <atomic>
#include <csignal>

#include <smartspectra/container/settings.h>
#include <smartspectra/container/cpu_continuous_rest_foreground_container.h>

namespace presage_api {

namespace fs = std::filesystem;

static std::atomic<bool> g_shutdown{false};

static void signal_handler(int) {
    g_shutdown = true;
}

// Process a video file through the SmartSpectra SDK in spot mode.
// Returns JSON with the computed vitals.
static nlohmann::json process_video(const std::string& video_path,
                                     const std::string& api_key)
{
    nlohmann::json result;
    std::mutex mtx;
    std::condition_variable cv;
    bool done = false;

    // Configure spot mode settings
    container::settings::Settings<
        container::settings::OperationMode::Spot,
        container::settings::IntegrationMode::Rest
    > settings;

    settings.video_source.input_video_path = video_path;
    settings.integration.api_key = api_key;
    settings.headless = true;
    settings.verbosity_level = 0;

    auto ctr = std::make_unique<
        container::CpuContinuousRestForegroundContainer>(settings);

    // Collect the final metrics
    ctr->SetOnCoreMetricsOutput(
        [&](const presage::physiology::MetricsBuffer& metrics,
            int64_t timestamp) -> absl::Status
        {
            std::lock_guard<std::mutex> lock(mtx);
            result = metrics_to_json(metrics, timestamp);
            done = true;
            cv.notify_one();
            return absl::OkStatus();
        });

    // Run processing (blocks until video is fully processed)
    auto status = ctr->Run();

    if (!status.ok()) {
        result["status"] = "error";
        result["error"] = std::string(status.message());
        return result;
    }

    // Wait for metrics if not received yet (with timeout)
    {
        std::unique_lock<std::mutex> lock(mtx);
        if (!done) {
            cv.wait_for(lock, std::chrono::seconds(10),
                        [&] { return done; });
        }
    }

    if (result.empty()) {
        result["status"] = "error";
        result["error"] = "No metrics received from SDK. "
                          "Video may be too short or face not detected.";
    }

    return result;
}

int run_server_mode(const ServerConfig& config) {
    std::signal(SIGINT, signal_handler);
    std::signal(SIGTERM, signal_handler);

    httplib::Server svr;

    // Create temp directory for uploaded videos
    fs::path tmp_dir = fs::temp_directory_path() / "presage_uploads";
    fs::create_directories(tmp_dir);

    // GET /health - health check
    svr.Get("/health", [](const httplib::Request&, httplib::Response& res) {
        nlohmann::json j;
        j["status"] = "ok";
        j["service"] = "presage-api";
        res.set_content(j.dump(), "application/json");
    });

    // POST /api/analyze - upload video, get vitals
    svr.Post("/api/analyze",
        [&config, &tmp_dir](const httplib::Request& req,
                            httplib::Response& res)
        {
            // Check for multipart file upload
            if (!req.has_file("video")) {
                nlohmann::json err;
                err["status"] = "error";
                err["error"] = "Missing 'video' file in multipart form data. "
                               "Send a video file (15-30+ seconds of face footage).";
                res.status = 400;
                res.set_content(err.dump(), "application/json");
                return;
            }

            auto file = req.get_file_value("video");

            // Determine file extension from filename
            std::string ext = ".mp4";
            auto dot = file.filename.rfind('.');
            if (dot != std::string::npos) {
                ext = file.filename.substr(dot);
            }

            // Save uploaded video to temp file
            fs::path tmp_file = tmp_dir /
                ("upload_" + std::to_string(
                    std::chrono::steady_clock::now()
                        .time_since_epoch().count()) + ext);

            {
                std::ofstream ofs(tmp_file, std::ios::binary);
                ofs.write(file.content.data(), file.content.size());
            }

            std::cout << "[server] Processing video: " << tmp_file
                      << " (" << file.content.size() << " bytes)" << std::endl;

            // Process through SDK
            auto result = process_video(tmp_file.string(), config.api_key);

            // Clean up temp file
            std::error_code ec;
            fs::remove(tmp_file, ec);

            // Set response
            if (result.value("status", "") == "error") {
                res.status = 422;
            }
            res.set_content(result.dump(2), "application/json");

            std::cout << "[server] Response: " << result.dump() << std::endl;
        });

    // Error handler
    svr.set_error_handler(
        [](const httplib::Request&, httplib::Response& res) {
            nlohmann::json err;
            err["status"] = "error";
            err["error"] = "Not found";
            res.set_content(err.dump(), "application/json");
        });

    // Set limits
    svr.set_payload_max_length(100 * 1024 * 1024);  // 100MB max upload

    std::cout << "[server] Presage API server starting on "
              << config.host << ":" << config.port << std::endl;
    std::cout << "[server] Endpoints:" << std::endl;
    std::cout << "  GET  /health        - Health check" << std::endl;
    std::cout << "  POST /api/analyze   - Upload video, get vitals" << std::endl;
    std::cout << "[server] Press Ctrl+C to stop." << std::endl;

    bool ok = svr.listen(config.host, config.port);
    if (!ok) {
        std::cerr << "[server] Failed to start on port " << config.port << std::endl;
        return 1;
    }

    return 0;
}

} // namespace presage_api
