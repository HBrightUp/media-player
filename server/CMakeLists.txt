cmake_minimum_required(VERSION 3.5)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPERIMENTAL_CXX_IMPORT_STD "0e5b6991-d74f-4b3d-a41c-cf096e0b2508") 

set(CMAKE_BUILD_TYPE "Debug")

project(server)


add_subdirectory(src)


add_executable(${PROJECT_NAME} main.cpp)


target_link_libraries(${PROJECT_NAME} 
    network
    common
)