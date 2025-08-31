#include <sys/socket.h>
#include <sys/epoll.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <fcntl.h>
#include <unistd.h>
#include<cstring>
#include<format>
#include"../include/server.h"
#include"../../common/include/common.h"
#include"../include/event.h"
#include"../../logger/include/log.h"

Server& Server::Instance() {
    static Server s;
    return s;
} 

Server::~Server() {
    if(pthread_cancel(epollThreadId_) == 0) {
        pthread_join(epollThreadId_, (void **)nullptr);
    }
}

void Server::init(const std::string& ip, const unsigned short port) {
    ip_ = ip;
    port_ = port;
}

bool Server::start() {

    auto& log = Logger::getInstance();
   
    epfd_ = epoll_create(EPOLL_MAX_SIZE);
    if(epfd_  < 0) {
        log.print("Create epoll failed.");
        return false;
    }
    event.reset(new CEvent(epfd_));

    listenfd_ = socket(AF_INET, SOCK_STREAM, 0);
    if (listenfd_ < 0) {
        log.print("Init socket failed.");
        close(epfd_);
        return false;
    } 

    log.print("Init socket success, epoll fd: ", epfd_, ", server listen fd: ", listenfd_);
    
    if(!event->set_nonblocking(listenfd_)) {
        close(listenfd_);
        close(epfd_);
        return false;
    }
    if(!event->register_event(listenfd_,  EPOLLIN | EPOLLET)) {
        close(listenfd_);
        close(epfd_);
        return false;
    }

    int opt = 1;
    if (setsockopt(listenfd_, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt)) < 0) {
        log.print("Set reuse of listen port failed.");
        close(listenfd_);
        close(epfd_);
        return false;
    }

    struct sockaddr_in serveraddr;
    memset(&serveraddr, 0, sizeof(serveraddr));
    serveraddr.sin_family   = AF_INET;
    serveraddr.sin_addr.s_addr = htonl(INADDR_ANY); 
    serveraddr.sin_port       = htons(port_);

    if(bind(listenfd_, (struct sockaddr *)&serveraddr, sizeof(serveraddr)) != 0) {
        log.print("Bind listen port failed, port: ", port_);
        close(listenfd_);
        close(epfd_);
        return false;
    }

    if(listen(listenfd_, port_) != 0) {
        log.print("Create listen port failed, port: ", port_);
        return false;
    }

    pthread_create(&epollThreadId_, nullptr, &Server::EventHandle, (void*)this);
    pool.reset( new CThreadPool<CTask>());

    log.print("Initial completed, the server starts running.");

    while (true)
    {
        std::this_thread::sleep_for(std::chrono::seconds(2));
    }
    
}

void* Server::EventHandle(void* arg)
{
	
	Server &s = *(Server*)arg;
	int nfds, connfd;
	auto& log = Logger::getInstance();
	
	while(true) {
		nfds = epoll_wait(s.epfd_, s.events, EPOLL_MAX_SIZE, 500);
		if(nfds > 0) {
			for(int i = 0; i < nfds; ++i) {
				connfd = s.events[i].data.fd;
			
				if( connfd == s.listenfd_ ) {
					CTask* t = new CAcceptTask();
					t->SetConnFd(connfd);
					s.pool->append(t);

				} else if(s.events[i].events & EPOLLIN)  {

					if ( connfd < 0)  {
						continue;
					}

					CTask* t = new CReadTask();
					t->SetConnFd(connfd);
					s.pool->append(t);

				} else if(s.events[i].events & EPOLLOUT) {
					
					CTask* t = new CWriteTask();
					t->SetConnFd(connfd);
					s.pool->append(t);

                    //WARNING: Since EPOLLOUT events are triggered frequently, as soon as the write task enters the queue, 
                    //turn off the EPOLLOUT monitoring immediately, otherwise it may trigger multiple repeated write operations.
                    Server::Instance().event->modify_event(connfd, EPOLLIN | EPOLLET);

				} else {
                    log.print("Other events: ", static_cast<unsigned int>(s.events[i].events));
                }
			}
		} else if (nfds == 0) {
			continue;
		} else {
			log.print("epoll_wait  faild.");
			break;
		}
	}
	
	return nullptr;
}