#include"../include/log.h"
#include<iostream>
#include<chrono>
#include <iomanip>

Logger& Logger::getInstance() {
        static Logger log;
        return log;
}
 
Logger::Logger() {
  
}


