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


// enum EventType
// {
//     EIN = EPOLLIN,			
// 	EOUT = EPOLLOUT,	  // 写事件
// 	ECLOSE = EPOLLRDHUP,  // 对端关闭连接或者写半部
// 	EPRI = EPOLLPRI,	  // 紧急数据到达
// 	EERR = EPOLLERR,	  // 错误事件
// 	EET = EPOLLET, 		  // 边缘触发
// 	EDEFULT = EIN | ECLOSE | EERR | EET
// };
 
class CEvent
{
public:
	CEvent();
	~CEvent();
	int Register_event(int fd, uint32_t );
	int modify_event(int fd, uint32_t);
	int unRegister_event(int fd);

	void SetNoblocking(int v_sockfd);
	inline void set_listenFd(int fd) { listenfd_ = fd; };

	static void* EventHandle(void* arg);

public:
	int epfd_;

private:
	int listenfd_;

private:
	
	bool is_running;
	pthread_t  m_tid;
	struct epoll_event events[EPOLL_MAX_SIZE];
	CThreadPool<CTask> *pool;
};