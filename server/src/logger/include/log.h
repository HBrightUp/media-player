#pragma once
#include <iostream>
#include <fstream>
#include <string>
#include <ctime>
#include<mutex>
#include<chrono>
#include <iomanip>


enum LoggerMode{
    ENU_STDOUT = 1,
    ENU_FILE,
};


class Logger {
    public:
        ~Logger();
        bool init(const std::string& filename, const LoggerMode& mode );

    private:
        Logger() = default;
        std::string currentDateTime();

         
    public:
        static Logger& getInstance();

        template<typename... Args>
        void print(Args&&... args) {

            std::unique_lock<std::mutex> lock(mutexLog_);

            if (logmode_ == LoggerMode::ENU_STDOUT) {
                (std::cout << currentDateTime() << "  "<< ... << args) << '\n';  // C++17 折叠表达式
            } else {
                if (logFile_.is_open()) {
                    (logFile_ << currentDateTime() << "  " << ... << args) << std::endl;
                } else {
                    std::cout << "log file was not open." << std::endl;
                }
            }
        }
        
   private:
        std::string filePath_;
        std::ofstream logFile_;
        std::mutex mutexLog_;
        LoggerMode logmode_;
    
};
 