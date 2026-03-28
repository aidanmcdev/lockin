#pragma once

#include <string>
#include <json.hpp>
#include <smartspectra/physiology/metrics.pb.h>

namespace presage_api {

// Convert a MetricsBuffer from the SDK into a JSON object
nlohmann::json metrics_to_json(
    const presage::physiology::MetricsBuffer& metrics,
    int64_t timestamp_ms);

// Convert edge metrics (per-frame) to JSON
nlohmann::json edge_metrics_to_json(
    const presage::physiology::Metrics& metrics);

// Get current ISO 8601 timestamp string
std::string iso_timestamp();

} // namespace presage_api
