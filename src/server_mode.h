#pragma once

#include <string>

namespace presage_api {

struct ServerConfig {
    std::string api_key;
    int port = 8080;
    std::string host = "0.0.0.0";
};

// Run the HTTP API server. Blocks until shutdown.
int run_server_mode(const ServerConfig& config);

} // namespace presage_api
