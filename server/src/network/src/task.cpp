#include<iostream>
#include <sys/socket.h>
#include <sys/epoll.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <fcntl.h>
#include"../include/task.h"
#include"../../common/include/common.h"
#include"../include/event.h"
#include"../include/server.h"

void CTask::SetConnFd(int fd)  
{  
    connfd = fd;  
}  
 
int CTask::GetConnFd()
{
    return connfd;
}

void CAcceptTask::setListenFd(int fd) {
    listenfd_ = fd;
}

int CAcceptTask::process() {

    std::cout << "CAcceptTask start my work" << std::endl;

    socklen_t clilenaddrLen = sizeof(struct sockaddr_in);
    struct sockaddr_in clientaddr;

    std::cout << "CAcceptTask::process() listenfd_: " << listenfd_<< std::endl;
    connfd = accept(listenfd_, (struct sockaddr *)&clientaddr, &clilenaddrLen);
    if(connfd < 0)
    {
        print_log("Accept client failed!");
        return 1;                
    }

    Server::Instance()->event->SetNoblocking(connfd);
    ///CEvent::SetNoblocking(connfd);

    char *str = inet_ntoa(clientaddr.sin_addr);
    int port = ntohs(clientaddr.sin_port);

    std::cout << "accapt a connection from " << str << ":" << port << std::endl;

    // ev.data.fd = connfd;
    // ev.events = EPOLLIN | EPOLLET;
    // //ev.events=EPOLLIN;
    // epoll_ctl(event->epfd, EPOLL_CTL_ADD, connfd, &ev); 
     Server::Instance()->event->Register_event(connfd, EPOLLIN | EPOLLET);

    return 0;
}

int CReadTask::process() {

    std::cout << "CReadTask start my work" << std::endl;

    int len;
    char line_buff[MAX_BUFFER_READ_ONCE_TIME];

    std::cout << "start read, connfd: " << connfd  << std::endl;
    if ( (len = read(connfd, line_buff, MAX_BUFFER_READ_ONCE_TIME)) < 0)  {
    
        if (errno == ECONNRESET)
        {
            close(connfd);
        }
        else {
            print_log("Read data  error!");
        }
            
    } else if (len == 0) {
        close(connfd);
    }

    line_buff[len] = '\0';
    std::cout << "read " << line_buff << std::endl;

    // ev.data.fd = sockfd;
    // ev.events = EPOLLOUT | EPOLLET; 
    // epoll_ctl(event->epfd,EPOLL_CTL_MOD, sockfd, &ev);

     Server::Instance()->event->modify_event(connfd, EPOLLOUT | EPOLLET);
    return 0;
}

int CWriteTask::process() {

    std::cout << "CWriteTask start my work" << std::endl;

    int len;
    char line_buff[MAX_BUFFER_READ_ONCE_TIME];

    len = write(connfd, line_buff, sizeof(line_buff)/sizeof(char));
    
    // ev.data.fd = sockfd;
    // ev.events = EPOLLIN | EPOLLET;
    // epoll_ctl(event->epfd, EPOLL_CTL_MOD, sockfd, &ev);

     Server::Instance()->event->modify_event(connfd, EPOLLIN | EPOLLET);
    return 0;
}