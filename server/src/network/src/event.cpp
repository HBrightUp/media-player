#include<iostream>
#include<format>
#include"../include/event.h"
#include"../../common/include/common.h"
#include"../../logger/include/log.h"
 
CEvent::~CEvent() {
  
}
 
bool CEvent::set_nonblocking(const int& fd) {

	auto& log = Logger::getInstance();

	int opts = fcntl(fd,F_GETFL);
	if (opts == -1) {
		log.print("Get fcntl of fd failed,");
		return false;
	}

	opts = opts|O_NONBLOCK;
	if (fcntl(fd, F_SETFL, opts) == -1) {
		return false;
	}
	
	return true;
}

bool CEvent::register_event(const int& fd, const uint32_t& type ) {

	struct epoll_event ev;
	ev.data.fd = fd;
	ev.events = type;

	auto& log = Logger::getInstance();
	if(epoll_ctl(epfd_, EPOLL_CTL_ADD, fd, &ev) == -1) {
		log.print("Add epoll ctl failed, fd: ", fd);
		return false;
	}
	return true;
}

bool CEvent::modify_event(const int& fd, const uint32_t& type) {

	struct epoll_event ev;
	ev.data.fd = fd;
	ev.events = type;

	if(epoll_ctl(epfd_, EPOLL_CTL_MOD, fd, &ev) == -1) {
		Logger::getInstance().print("Modify epoll ctl failed, fd: ", fd);
        return false;
    }

	return true;
}
 
bool CEvent::unregister_event(const int& fd)
{
    if(epoll_ctl(epfd_, EPOLL_CTL_DEL, fd, NULL) == -1) {
		Logger::getInstance().print("Unregister epoll ctl failed, fd: ", fd);
        return false;
    }

    return true;
}
 
 