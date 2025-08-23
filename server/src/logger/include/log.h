#pragma once
#include <iostream>
#include <fstream>
#include <string>
#include <ctime>
#include<mutex>
#include<chrono>
#include <iomanip>




class Logger {

    private:
        Logger();
         
    public:
        static Logger& getInstance();

        template<typename... Args>
        void print(Args&&... args) {
            std::unique_lock<std::mutex> lock(mutex_log_);
            auto now = std::chrono::system_clock::now();
            std::time_t now_c = std::chrono::system_clock::to_time_t(now);

            auto cur_time = std::put_time(std::localtime(&now_c), "%Y-%m-%d %H:%M:%S ");

            (std::cout << cur_time << ... << args) << '\n';  // C++17 折叠表达式
        }
 
   private:

        std::mutex mutex_log_;
    
};
 