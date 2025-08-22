#pragma once
#include<iostream>
#include"./event.h"

class Server {

    public:
        static Server* Instance(); 
        ~Server();
        
        void set_server_info(const std::string& ip, const unsigned short port);
        bool start();
        bool run();

    private:
        Server() {};
        bool set_nonblocking(const int sock);
    
    private:
        std::string ip_;
        unsigned short port_;
        //int epfd_;
        int listenfd_;
    public:
        CEvent* event;

};