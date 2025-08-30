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
        return false;
    }
    event.reset(new CEvent(epfd_));

    listenfd_ = socket(AF_INET, SOCK_STREAM, 0);
    if (listenfd_ < 0) {
       return false;
    } 

    log.print(std::format("listenFd: {}", listenfd_));
    
    event->set_nonblocking(listenfd_);
    event->register_event(listenfd_,  EPOLLIN | EPOLLET);

    int opt = 1;
    if (setsockopt(listenfd_, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt)) < 0) {
        return false;
    }

    struct sockaddr_in serveraddr;
    memset(&serveraddr, 0, sizeof(serveraddr));
    serveraddr.sin_family     = AF_INET;
    serveraddr.sin_addr.s_addr = htonl(INADDR_ANY); 
    serveraddr.sin_port       = htons(port_);

    if(0 != bind(listenfd_, (struct sockaddr *)&serveraddr, sizeof(serveraddr)))
    {
        log.print(std::format("bind failed, port: {}", port_));
        return false;
    }

    if(0 != listen(listenfd_, port_)) 
    {
        log.print(std::format("listen failed, port: {}", port_));
        return false;
    }

    pthread_create(&epollThreadId_, nullptr, &Server::EventHandle, (void*)this);

  
    pool.reset( new CThreadPool<CTask>());

    while (true)
    {
        std::this_thread::sleep_for(std::chrono::seconds(2));
    }
    
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


void* Server::EventHandle(void* arg)
{
	
	Server &s = *(Server*)arg;
	int nfds, connfd;
	Logger& log = Logger::getInstance();
	
	while(true) {
		//log.print("epoll_wait start work");
		nfds = epoll_wait(s.epfd_, s.events, EPOLL_MAX_SIZE, 1000);
		if(nfds > 0) {
			for(int i = 0; i < nfds; ++i) {
				connfd = s.events[i].data.fd;
				//log.print(std::format("epoll_wait  connfd: {}", connfd));
			
				if( connfd == s.listenfd_ ) {
					CTask* t = new CAcceptTask();
					t->SetConnFd(connfd);
					s.pool->append(t);

				} else if(s.events[i].events & EPOLLIN)  {

					if ( connfd < 0)  {
						continue;
					}

					log.print(std::format("Addread task, fd: {}", connfd));
		
					CTask* t = new CReadTask();
					t->SetConnFd(connfd);

					
					s.pool->append(t);
				} else if(s.events[i].events & EPOLLOUT) {
					log.print(std::format("Add write task, fd: {}", connfd));
					
					CTask* t = new CWriteTask();
					t->SetConnFd(connfd);
					s.pool->append(t);

                    //WARNING: Since EPOLLOUT events are triggered frequently, as soon as the write task enters the queue, 
                    //turn off the EPOLLOUT monitoring immediately, otherwise it may trigger multiple repeated write operations.
                    Server::Instance().event->modify_event(connfd, EPOLLIN | EPOLLET);

				} else {
                    log.print("other event: ", static_cast<unsigned int>(s.events[i].events));
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