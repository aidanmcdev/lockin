cmake_minimum_required(VERSION 3.27.0)
project(presage_vitals CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(SmartSpectra REQUIRED)
find_package(OpenCV REQUIRED)

add_executable(extract_vitals extract_vitals.cc)
target_link_libraries(extract_vitals
    SmartSpectra::Container
    ${OpenCV_LIBS}
)
