#pragma once

#include <string>

namespace presage_api {

struct WebcamConfig {
    std::string api_key;
    int camera_index = 0;
    bool headless = false;  // true = no GUI window, just terminal output
};

// Run the webcam mode: continuous capture + print vitals to stdout.
// Blocks until user presses 'q' or Ctrl+C.
int run_webcam_mode(const WebcamConfig& config);

} // namespace presage_api
