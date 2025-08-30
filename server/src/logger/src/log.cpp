#include"../include/log.h"
#include<iostream>
#include<chrono>
#include <iomanip>

Logger& Logger::getInstance() {
    static Logger log;
    return log;
}

bool Logger::init(const std::string& filename, const LoggerMode& mode) {

    logmode_ = mode;
    
    if (mode == ENU_STDOUT) {
        return true;
    }

    logFile_.open(filename, std::ios::app); 

    if (!logFile_.is_open()) {
        std::cout << "Open log file failed: " << filename << std::endl;
        return false; 
    }
    return true;
}

std::string Logger::currentDateTime() {
    std::time_t now = std::time(nullptr);
    char buf[64];
    std::strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M:%S", std::localtime(&now));
    return buf;
}

Logger::~Logger() {
    if (logFile_.is_open()) {
        logFile_.close();
    }
}



