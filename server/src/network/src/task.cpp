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
    auto& log = Logger::getInstance();
    char* buf = CMsgManage::getInstance()->get_or_create_processor(connfd)->get_reader();
    memset(buf, 0, sizeof(buf)/sizeof(char));

    while(true) {
        read_n = read(connfd, buf + pos, MAX_BUFFER_READ_ONCE_TIME - 1);
        log.print("Receive data, fd: ", connfd, ", size of read: ", read_n);

        if (read_n < 0) {
            if(errno == EAGAIN || errno == EWOULDBLOCK) {
                break;
            } else {
                Server::Instance().event.get()->unregister_event(connfd);
                close(connfd);
                log.print("Read from client exception, fd: ", connfd);
                return 0; 
            }
        } else if ( read_n == 0) {
            log.print("Client closed, fd: ", connfd);
            Server::Instance().event.get()->unregister_event(connfd);
            close(connfd);
            return 0;
        } else {
            pos += read_n;

            // need modify
            // overflow, process furture.
            if (read_n == MAX_BUFFER_READ_ONCE_TIME - 1) {
                break;
            }
        }
    }

    buf[pos] = '\0';
    Logger::getInstance().print("Clien fd-", connfd, " recevied data, size: ", pos);

    bool is_success = CMsgManage::getInstance()->get_or_create_processor(connfd)->process();
    if(is_success) {
        Server::Instance().event->modify_event(connfd, EPOLLOUT | EPOLLET);
    } else {
        log.print("Server process message failed");
    }

    return 0;
}

int CWriteTask::process() {

    int write_n;
    int pos = 0;

    auto& log = Logger::getInstance();
    char* buf = CMsgManage::getInstance()->get_or_create_processor(connfd)->get_writer();
    int data_size = CMsgManage::getInstance()->get_or_create_processor(connfd)->get_writen_data_len();
    
    log.print("Start write task, need to be writenn size: ", data_size);

    while(true) {
        write_n = write(connfd, buf + pos, data_size);

        if(write_n < 0) {
            if(errno == EAGAIN || errno == EWOULDBLOCK) {
                continue;
            } else {
                log.print("Write to client exception, fd: ", connfd);
                Server::Instance().event.get()->unregister_event(connfd);
                close(connfd);
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