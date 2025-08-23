#include<iostream>
#include<format>
#include"../include/event.h"
#include"../../common/include/common.h"
#include"../../logger/include/log.h"
 
CEvent::~CEvent() {
  
}
 
void CEvent::set_nonblocking(int v_sockfd) {

	int opts = fcntl(v_sockfd,F_GETFL);
	opts = opts|O_NONBLOCK;
	fcntl(v_sockfd, F_SETFL, opts);
	
}
 
 

int CEvent::register_event(int fd, uint32_t type ) {

	struct epoll_event ev;
	ev.data.fd = fd;
	ev.events = type;

	if(epoll_ctl(epfd_, EPOLL_CTL_ADD, fd, &ev) == -1) {
		return -1;
	}
	return 0;
}

int CEvent::modify_event(int fd, uint32_t type) {

	struct epoll_event ev;
	ev.data.fd = fd;
	ev.events = type;

	if(epoll_ctl(epfd_, EPOLL_CTL_MOD, fd, &ev) == -1) {
        return -1;
    }

	return 0;
}
 
int CEvent::unregister_event(int fd)
{
    if(epoll_ctl(epfd_, EPOLL_CTL_DEL, fd, NULL) == -1) {
		std::cout << "unRegister_event failed, fd: " << fd << std::endl;
        return -1;
    }

    return 0;
}
 
 