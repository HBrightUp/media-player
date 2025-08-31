#pragma once
#include <netinet/in.h>
#include <arpa/inet.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <fcntl.h>
#include <sys/wait.h>
#include <sys/epoll.h>
#include <errno.h>
#include"../../common/include/common.h"
#include"./threadpool.hpp"
#include"./task.h"


 
class CEvent
{
public:
	CEvent(int fd):epfd_(fd){};
	~CEvent();

	bool register_event(const int& fd, const uint32_t& type );
	bool modify_event(const int& fd, const uint32_t& type);
	bool unregister_event(const int& fd);
	bool set_nonblocking(const int& fd);


private:
	int epfd_;
};