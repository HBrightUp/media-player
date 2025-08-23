#pragma once
#include<iostream>
#include"./event.h"
#include<memory>
#include"../include/task.h"
#include"../include/threadpool.hpp"

class Server {

    public:
        static Server& Instance(); 
        ~Server();
        
        void init(const std::string& ip, const unsigned short port);
        bool start();

        

    private:
        Server() {};
        bool set_nonblocking(const int sock);

        static void* EventHandle(void* arg);
    
    private:
        std::string ip_;
        unsigned short port_;
        
        int listenfd_;
        int epfd_;
        //CThreadPool<CTask> *pool;

        std::unique_ptr<CThreadPool<CTask>> pool;
        pthread_t  epollThreadId_;
        struct epoll_event events[EPOLL_MAX_SIZE];

    public:
        std::unique_ptr<CEvent> event;
        

};