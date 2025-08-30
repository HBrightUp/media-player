#include<iostream>
#include <sys/socket.h>
#include <sys/epoll.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <fcntl.h>
#include<format>
#include<cstring>
#include"../include/task.h"
#include"../../logger/include/log.h"
#include"../include/event.h"
#include"../include/server.h"
#include"../include/msg_manage.h"



CTask::~CTask() {

}

void CTask::SetConnFd(int fd)  
{  
    connfd = fd;  
}  
 
int CTask::GetConnFd()
{
    return connfd;
}


int CAcceptTask::process() {

    socklen_t clilenaddrLen = sizeof(struct sockaddr_in);
    struct sockaddr_in clientaddr;
    int clientFd;
    Logger& log = Logger::getInstance();

    while(true) {

        //log.print("Start accetp  connect...");
        clientFd = accept(connfd, (struct sockaddr *)&clientaddr, &clilenaddrLen);
        if(clientFd == -1 )
        {
            //log.print("Accetp connect finished!");
            return -1;                
        }

        Server::Instance().event->set_nonblocking(clientFd);
        char *ip = inet_ntoa(clientaddr.sin_addr);
        int port = ntohs(clientaddr.sin_port);

        //log.print(std::format("accetped client  connect, client fd: {}", clientFd));

        //Logger::getInstance().print(std::format("client connected, ip: {}, port{}", ip, port));

        log.print("Accept client connected, fd: ", clientFd, ",ip: ", ip, ", port: ", port);

        Server::Instance().event->register_event(clientFd, EPOLLIN | EPOLLET);

    }

    return 0;
}

int CReadTask::process() {

    int pos = 0;
    int read_n = 0;
    
    //char buf[MAX_BUFFER_READ_ONCE_TIME];
    char* buf = CMsgManage::getInstance()->getProcessor(connfd)->getReader();

    memset(buf, 0, sizeof(buf)/sizeof(char));



    while(true) {
        read_n = read(connfd, buf + pos, MAX_BUFFER_READ_ONCE_TIME - 1);
        Logger::getInstance().print(std::format("receive data, fd: {}, read_n: {}", connfd, read_n));

        if (read_n < 0) {
            if(errno == EAGAIN || errno == EWOULDBLOCK) {
                break;
            } else {
                Server::Instance().event.get()->unregister_event(connfd);
                close(connfd);
                return 0; 
            }
        } else if ( read_n == 0) {
            Logger::getInstance().print(std::format("client exception, fd: {}", connfd));
            Server::Instance().event.get()->unregister_event(connfd);
            close(connfd);
            return 0;
        } else {
            pos += read_n;

            // overflow, process furture.
            if (read_n == MAX_BUFFER_READ_ONCE_TIME - 1) {
                break;
            }
        }
    }

    buf[pos] = '\0';
    Logger::getInstance().print(std::format("{} received data: {}", connfd, buf));

    bool is_success = CMsgManage::getInstance()->getProcessor(connfd)->process();
    if(is_success) {
        Server::Instance().event->modify_event(connfd, EPOLLOUT | EPOLLET);
    }

    return 0;
}

int CWriteTask::process() {

    int write_n;
    int pos = 0;
    //char buf[MAX_BUFFER_READ_ONCE_TIME];
    
    //memset(buf, 0, sizeof(buf)/sizeof(char));

    //std::string str = "hello, " + std::to_string(connfd);
   
    //memcpy(buf, str.c_str(), data_size);
    auto& log = Logger::getInstance();

    char* buf = CMsgManage::getInstance()->getProcessor(connfd)->getWriter();
    int data_size = CMsgManage::getInstance()->getProcessor(connfd)->getWriteDataLen();
    
    log.print("Start write task, need to be writenn size: ", data_size);

    while(true) {
        write_n = write(connfd, buf + pos, data_size);
        //log.print("write_n:", write_n);

        if(write_n < 0) {
            if(errno == EAGAIN || errno == EWOULDBLOCK) {
                //log.print("Network busy now.");
                continue;
            } else {
                log.print("Other case.");
                break;
            }
    
        } else if (write_n < data_size) {
            pos += write_n;
            data_size -= write_n;
        } else {
            pos += write_n;
            break;
        }
    }
  
    log.print("Send to client fd: ", connfd, ", data_size: ", data_size, ", pos: ", pos);

    //WARNING: Because the EPOLLET operation will be triggered again after the write is completed, it is too late to turn it off here.
   // Server::Instance().event->modify_event(connfd, EPOLLIN | EPOLLET);
    return 0;
}