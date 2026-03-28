cmake_minimum_required(VERSION 3.27.0)
project(presage_api CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# SmartSpectra SDK
find_package(SmartSpectra REQUIRED)

# OpenCV
find_package(OpenCV REQUIRED)

# Threads (needed by httplib)
find_package(Threads REQUIRED)

# Header-only libs live in include/
include_directories(${CMAKE_SOURCE_DIR}/include)

add_executable(presage_api
    src/main.cpp
    src/webcam_mode.cpp
    src/server_mode.cpp
    src/metrics_json.cpp
)

target_link_libraries(presage_api
    SmartSpectra::Container
    SmartSpectra::Gui
    ${OpenCV_LIBS}
    Threads::Threads
)

# Install target for deployment
install(TARGETS presage_api DESTINATION bin)
