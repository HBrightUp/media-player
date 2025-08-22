#include <sys/socket.h>
#include <sys/epoll.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <fcntl.h>
#include <unistd.h>
#include<cstring>
#include"../include/server.h"
#include"../../common/include/common.h"
#include"../include/event.h"

Server* Server::Instance() {
    static Server s;
    return &s;
} 

Server::~Server() {

}

void Server::set_server_info(const std::string& ip, const unsigned short port) {
    ip_ = ip;
    port_ = port;
}

bool Server::run() {
    struct epoll_event ev, event_list[EPOLL_MAX_SIZE];
    
    //epfd_ = epoll_create(256); 
    event = new CEvent();

    struct sockaddr_in clientaddr;
    socklen_t clilenaddrLen;
    struct sockaddr_in serveraddr;
    
    listenfd_ = socket(AF_INET, SOCK_STREAM, 0);
    if (listenfd_ < 0) {
       print_log("Create server socket failed!");
    } else {
        std::cout << "Listenfd: " << listenfd_ << std::endl;
    }

    //set_nonblocking(listenfd_);
    event->set_listenFd(listenfd_);
    event->SetNoblocking(listenfd_);


    int opt = 1;
    if (setsockopt(listenfd_, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt)) < 0) {
        print_log("Set reuse of server port failed!");
    }
 
    // ev.data.fd = listenfd_;
    // ev.events = EPOLLIN | EPOLLET;
    // epoll_ctl(event->epfd, EPOLL_CTL_ADD, listenfd_, &ev);

    event->Register_event(listenfd_,  EPOLLIN | EPOLLET);


    memset(&serveraddr, 0, sizeof(serveraddr));
    serveraddr.sin_family     = AF_INET;
    serveraddr.sin_addr.s_addr=htonl(INADDR_ANY); 
    serveraddr.sin_port       = htons(SERVER_PORT);

    if(0 != bind(listenfd_, (struct sockaddr *)&serveraddr, sizeof(serveraddr)))
    {
        print_log("Server bind port failed!");
    }

    if(0 != listen(listenfd_, SERVER_PORT)) 
    {
        print_log("Server listen port failed!");
    }

    int nfds, connfd, sockfd,len;
    clilenaddrLen = sizeof(struct sockaddr_in);
    char line_buff[MAX_BUFFER_READ_ONCE_TIME];

    std::cout << "main thread load finish" << std::endl;
    while (true)
    {
        std::this_thread::sleep_for(std::chrono::seconds(2));
    }
    
    
}

bool Server::start() {
    
    // struct epoll_event ev, event_list[EPOLL_MAX_SIZE];
    
    // epfd_ = epoll_create(256); 
    

    // struct sockaddr_in clientaddr;
    // socklen_t clilenaddrLen;
    // struct sockaddr_in serveraddr;
    
    // listenfd_ = socket(AF_INET, SOCK_STREAM, 0);
    // if (listenfd_ < 0) {
    //    print_log("Create server socket failed!");
    // }

    // set_nonblocking(listenfd_);



    // int opt = 1;
    // if (setsockopt(listenfd_, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt)) < 0) {
    //     print_log("Set reuse of server port failed!");
    // }
 
    // ev.data.fd = listenfd_;
    // ev.events = EPOLLIN | EPOLLET;
    // epoll_ctl(epfd_, EPOLL_CTL_ADD, listenfd_, &ev);

    // memset(&serveraddr, 0, sizeof(serveraddr));
    // serveraddr.sin_family     = AF_INET;
    // serveraddr.sin_addr.s_addr=htonl(INADDR_ANY); 
    // serveraddr.sin_port       = htons(SERVER_PORT);

    // if(0 != bind(listenfd_, (struct sockaddr *)&serveraddr, sizeof(serveraddr)))
    // {
    //     print_log("Server bind port failed!");
    // }

    // if(0 != listen(listenfd_, SERVER_PORT)) 
    // {
    //     print_log("Server listen port failed!");
    // }

    // int nfds, connfd, sockfd,len;
    // clilenaddrLen = sizeof(struct sockaddr_in);
    // char line_buff[MAX_BUFFER_READ_ONCE_TIME];

    // while(true) {
        
    //     nfds = epoll_wait(epfd_, event_list, EPOLL_MAX_SIZE, SERVER_EVENT_TIMEOUT); 
    //     for(int i = 0; i < nfds; ++i)
    //     {
    //         if( event_list[i].data.fd == listenfd_ ) 
    //         {
    //             connfd = accept(listenfd_, (struct sockaddr *)&clientaddr, &clilenaddrLen);
    //             if(connfd < 0)
    //             {
    //                 print_log("Accept client failed!");
    //                 return 1;                
    //             }
 
    //             set_nonblocking(connfd);
 
    //             char *str = inet_ntoa(clientaddr.sin_addr);
    //             int port = ntohs(clientaddr.sin_port);
 
    //             std::cout << "accapt a connection from " << str << ":" << port << std::endl;

    //             ev.data.fd = connfd;
    //             ev.events = EPOLLIN | EPOLLET;
    //             //ev.events=EPOLLIN;
    //             epoll_ctl(epfd_, EPOLL_CTL_ADD, connfd, &ev); 

    //         } else if(event_list[i].events & EPOLLIN)  {
    //             if ( (sockfd = event_list[i].data.fd) < 0) {
    //                 continue; 
    //             }
                 
    //             std::cout << "start read." << std::endl;
    //             if ( (len = read(sockfd, line_buff, MAX_BUFFER_READ_ONCE_TIME)) < 0)  {
                
    //                 if (errno == ECONNRESET)
    //                 {
    //                     close(sockfd);
    //                     event_list[i].data.fd = -1;
    //                 }
    //                 else {
    //                     print_log("Read data  error!");
    //                 }
                        
    //             } else if (len == 0) {
    //                 close(sockfd);
    //                 event_list[i].data.fd = -1;
    //             }
 
    //             line_buff[len] = '\0';
    //             std::cout << "read " << line_buff << std::endl;
 
    //             ev.data.fd = sockfd;
    //             ev.events = EPOLLOUT | EPOLLET; 
    //             epoll_ctl(epfd_,EPOLL_CTL_MOD, sockfd, &ev);
 
    //         }
    //         else if(event_list[i].events & EPOLLOUT) // 如果有数据发送
    //         {
    //             sockfd = event_list[i].data.fd;
    //             write(sockfd, line_buff, len);
               
    //             ev.data.fd = sockfd;
    //             ev.events = EPOLLIN | EPOLLET;
    //             epoll_ctl(epfd_, EPOLL_CTL_MOD, sockfd, &ev);
    //         }
    //     }
    
    // }

    return true;
}

bool Server::set_nonblocking(const int sock)
{
    int opts;
    opts = fcntl(sock, F_GETFL);
    if(opts < 0) {
        return false;
    }

    opts = opts | O_NONBLOCK;
    if(fcntl(sock, F_SETFL, opts) < 0) {
        return false;
    }

    return true;
}

