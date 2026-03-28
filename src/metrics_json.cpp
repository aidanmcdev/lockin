#include "metrics_json.h"
#include <chrono>
#include <ctime>
#include <iomanip>
#include <sstream>

namespace presage_api {

nlohmann::json metrics_to_json(
    const presage::physiology::MetricsBuffer& metrics,
    int64_t timestamp_ms)
{
    nlohmann::json result;
    result["status"] = "success";
    result["timestamp"] = iso_timestamp();
    result["timestamp_ms"] = timestamp_ms;

    // Pulse metrics
    if (metrics.has_pulse()) {
        auto& pulse = metrics.pulse();
        if (pulse.rate_size() > 0) {
            result["pulse_rate"] = pulse.rate().rbegin()->value();
        }
        if (pulse.rate_variability_size() > 0) {
            result["pulse_rate_variability"] = pulse.rate_variability().rbegin()->value();
        }
    }

    // Breathing metrics
    if (metrics.has_breathing()) {
        auto& breathing = metrics.breathing();
        if (breathing.rate_size() > 0) {
            result["breathing_rate"] = breathing.rate().rbegin()->value();
        }
    }

    return result;
}

nlohmann::json edge_metrics_to_json(
    const presage::physiology::Metrics& metrics)
{
    nlohmann::json result;
    result["timestamp"] = iso_timestamp();
    result["type"] = "edge";

    // Edge metrics provide per-frame data
    if (metrics.has_pulse()) {
        if (metrics.pulse().has_rate()) {
            result["pulse_rate"] = metrics.pulse().rate().value();
        }
    }
    if (metrics.has_breathing()) {
        if (metrics.breathing().has_rate()) {
            result["breathing_rate"] = metrics.breathing().rate().value();
        }
    }

    return result;
}

std::string iso_timestamp() {
    auto now = std::chrono::system_clock::now();
    auto time_t = std::chrono::system_clock::to_time_t(now);
    std::tm tm{};
    gmtime_r(&time_t, &tm);
    std::ostringstream oss;
    oss << std::put_time(&tm, "%Y-%m-%dT%H:%M:%SZ");
    return oss.str();
}

} 
