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

        log.print("Start accetp  connect...");
        clientFd = accept(connfd, (struct sockaddr *)&clientaddr, &clilenaddrLen);
        if(clientFd == -1 )
        {
            log.print("Accetp connect failed!");
            return -1;                
        }

        log.print(std::format("accetped client  connect, client fd: {}", clientFd));

        Server::Instance().event->set_nonblocking(clientFd);

        char *ip = inet_ntoa(clientaddr.sin_addr);
        int port = ntohs(clientaddr.sin_port);

        Logger::getInstance().print(std::format("client connected, ip: {}, port{}", ip, port));

        Server::Instance().event->register_event(clientFd, EPOLLIN | EPOLLET);

    }

    return 0;
}

int CReadTask::process() {

    int pos = 0;
    int read_n = 0;
    
    char buf[MAX_BUFFER_READ_ONCE_TIME];
    memset(buf, 0, sizeof(buf)/sizeof(char));

    while(true) {
        std::cout << "111" << std::endl;
        read_n = read(connfd, buf + pos, MAX_BUFFER_READ_ONCE_TIME - 1);
        Logger::getInstance().print(std::format("receive data, fd: {}, read_n: {}", connfd, read_n));

        if (read_n < 0) {
            if(errno == EAGAIN || errno == EWOULDBLOCK) {
                break;
            } else {
                Server::Instance().event.get()->unregister_event(connfd);
                //close(connfd);
                break; 
            }
        } else if ( read_n == 0) {
            Logger::getInstance().print(std::format("client exception, fd: {}", connfd));
            Server::Instance().event.get()->unregister_event(connfd);
            close(connfd);
            break;
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

     Server::Instance().event->modify_event(connfd, EPOLLOUT | EPOLLET);
    return 0;
}

int CWriteTask::process() {

    int write_n, pos;
    char buf[MAX_BUFFER_READ_ONCE_TIME];
    
    memset(buf, 0, sizeof(buf)/sizeof(char));

    std::string str = "hello, " + std::to_string(connfd);
    int data_size = str.length();
    memcpy(buf, str.c_str(), data_size);
    
    bool is_success = false;

    while(true) {
        write_n = write(connfd, buf + pos, data_size);
        if(write_n < 0) {
            if(errno == EAGAIN || errno == EWOULDBLOCK) {
                continue;
            } else {
                break;
            }
    
        } else if (write_n < data_size) {
            pos += write_n;
            data_size -= write_n;
        } else {
            is_success = true;
            break;
        }
    }

    Logger::getInstance().print(std::format("Send data to {}: {}", connfd, buf));

    Server::Instance().event->modify_event(connfd, EPOLLIN | EPOLLET);
    return is_success ? 0 : -1;
}