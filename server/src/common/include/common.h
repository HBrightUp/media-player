#pragma once 
#include<iostream>


const unsigned int  EPOLL_MAX_SIZE = 10240;
const std::string SERVER_IP = "0.0.0.0";
const unsigned short SERVER_PORT = 8888;
const unsigned int SERVER_EVENT_TIMEOUT = 500;
const unsigned int MAX_BUFFER_READ_ONCE_TIME = 1024 ;

void print_log(std::string str);
