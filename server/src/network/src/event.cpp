#include<iostream>
#include"../include/event.h"
#include"../../common/include/common.h"


CEvent::CEvent()
{
    
    epfd_ = epoll_create(EPOLL_MAX_SIZE);
    if(epfd_  < 0) {
        printf("epoll_create failed.");
    }

    pthread_t tid = 0;
    pthread_create(&tid, nullptr, &CEvent::EventHandle, (void*)this);

    m_tid = tid;
    //线程池初始化
    pool = new CThreadPool<CTask>();
    
}
 
 
CEvent::~CEvent()
{
    if(pthread_cancel(m_tid) == 0)
    {
        pthread_join(m_tid, (void **)NULL);
    }
}
 
 
 
void CEvent::SetNoblocking(int v_sockfd)
{
	int opts = fcntl(v_sockfd,F_GETFL);
	if(opts < 0)
	{
		printf("fcntl(sockfd, F_GETFL) failed.");
		opts = opts|O_NONBLOCK;
	}
	fcntl(v_sockfd, F_SETFL, opts);
	
}
 
 

int CEvent::Register_event(int fd, uint32_t type )
{
    //SetNoblocking(fd);

	struct epoll_event ev;
	ev.data.fd = fd;
	ev.events = type;

	if(epoll_ctl(epfd_, EPOLL_CTL_ADD, fd, &ev) == -1)
	{
		std::cout << "Register_event failed, fd: " << fd << std::endl;
		return -1;
	}
	return 0;
}
int CEvent::modify_event(int fd, uint32_t type) {

	struct epoll_event ev;
	ev.data.fd = fd;
	ev.events = type;

	if(epoll_ctl(epfd_, EPOLL_CTL_MOD, fd, &ev) == -1) {
		std::cout << "modify_event failed, fd: " << fd << std::endl;
        return -1;
    }

	return 0;
}
 
int CEvent::unRegister_event(int fd)
{
    if(epoll_ctl(epfd_, EPOLL_CTL_DEL, fd, NULL) == -1)
    {
		std::cout << "unRegister_event failed, fd: " << fd << std::endl;
        return -1;
    }
    return 0;
}
 
 
void* CEvent::EventHandle(void* arg)
{
	
	CEvent &ev = *(CEvent*)arg;
	int nfds, connfd;
	while(true)
	{
		std::cout << "EventHandle  epoll_wait" << std::endl;
		nfds = epoll_wait(ev.epfd_, ev.events, EPOLL_MAX_SIZE, -1);
		if(nfds < 0)
		{
			std::cout << "epoll_wait failed, epfd: " << ev.epfd_ << std::endl;
		}
		for(int i = 0; i < nfds; ++i)
		{
			
			connfd = ev.events[i].data.fd;
			
			std::cout << "receive connfd: " << connfd << std::endl;
			std::cout << "receive listenfd_: " << ev.listenfd_ << std::endl;

			// if(ev.events[i].events & EPOLLIN)
			// {
			// 	CTask* ta = new CMyTask;       //  具体的方法自己实现。
			// 	ta->SetConnFd(connfd);
			// 	ev.pool->append(ta);
				
			// }

			if( connfd == ev.listenfd_ ) {
				std::cout << "accept fd." << std::endl;
				CTask* t = new CAcceptTask();
				t->SetConnFd(connfd);
				ev.pool->append(t);
			} else if(ev.events[i].events & EPOLLIN)  {

				if ( connfd < 0)  {
					continue;
				}
				std::cout << "read fd." << std::endl;
				CTask* t = new CReadTask();
				t->SetConnFd(connfd);
				ev.pool->append(t);
			} else {
				std::cout << "write fd." << std::endl;
				CTask* t = new CWriteTask();
				t->SetConnFd(connfd);
				ev.pool->append(t);
			}
		}
	}
	
	
	
}