#include "webcam_mode.h"
#include "server_mode.h"

#include <iostream>
#include <string>
#include <cstdlib>

static void print_usage(const char* program) {
    std::cout << "Presage API - SmartSpectra Vital Signs Tool\n"
              << "\n"
              << "Usage: " << program << " --mode <webcam|server> [options]\n"
              << "\n"
              << "Modes:\n"
              << "  webcam   Capture from camera, print vitals to terminal\n"
              << "  server   HTTP API server accepting video uploads\n"
              << "\n"
              << "Options:\n"
              << "  --api-key <key>    Presage API key (or set PRESAGE_API_KEY env var)\n"
              << "  --camera <index>   Camera device index (webcam mode, default: 0)\n"
              << "  --headless         No GUI window (webcam mode)\n"
              << "  --port <port>      Server port (server mode, default: 8080)\n"
              << "  --host <addr>      Server bind address (server mode, default: 0.0.0.0)\n"
              << "  --help             Show this help\n"
              << std::endl;
}

int main(int argc, char* argv[]) {
    std::string mode;
    std::string api_key;
    int camera_index = 0;
    bool headless = false;
    int port = 8080;
    std::string host = "0.0.0.0";

    // Parse command line args
    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];

        if (arg == "--help" || arg == "-h") {
            print_usage(argv[0]);
            return 0;
        } else if (arg == "--mode" && i + 1 < argc) {
            mode = argv[++i];
        } else if (arg == "--api-key" && i + 1 < argc) {
            api_key = argv[++i];
        } else if (arg == "--camera" && i + 1 < argc) {
            camera_index = std::stoi(argv[++i]);
        } else if (arg == "--headless") {
            headless = true;
        } else if (arg == "--port" && i + 1 < argc) {
            port = std::stoi(argv[++i]);
        } else if (arg == "--host" && i + 1 < argc) {
            host = argv[++i];
        } else {
            std::cerr << "Unknown argument: " << arg << std::endl;
            print_usage(argv[0]);
            return 1;
        }
    }

    // API key from env if not provided via CLI
    if (api_key.empty()) {
        const char* env_key = std::getenv("PRESAGE_API_KEY");
        if (env_key) {
            api_key = env_key;
        }
    }

    if (api_key.empty()) {
        std::cerr << "Error: API key required. Use --api-key or set PRESAGE_API_KEY\n";
        return 1;
    }

    if (mode.empty()) {
        std::cerr << "Error: --mode is required (webcam or server)\n";
        print_usage(argv[0]);
        return 1;
    }

    if (mode == "webcam") {
        presage_api::WebcamConfig cfg;
        cfg.api_key = api_key;
        cfg.camera_index = camera_index;
        cfg.headless = headless;
        return presage_api::run_webcam_mode(cfg);

    } else if (mode == "server") {
        presage_api::ServerConfig cfg;
        cfg.api_key = api_key;
        cfg.port = port;
        cfg.host = host;
        return presage_api::run_server_mode(cfg);

    } else {
        std::cerr << "Error: Unknown mode '" << mode << "'. Use 'webcam' or 'server'.\n";
        return 1;
    }
}
