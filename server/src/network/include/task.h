#pragma once

#include<iostream>

class CTask {
protected:
    std::string m_strTaskName;   //任务的名称
    int connfd;    //接收的地址
 
public:
    CTask() = default;
    CTask(std::string &taskName): m_strTaskName(taskName), connfd(0) {}
    virtual int process() = 0;
    void SetConnFd(int data);   //设置接收的套接字连接号。
    int GetConnFd();
    virtual ~CTask();
    
};


class CAcceptTask : public CTask {
    public:
        int process() override;
};  

class CReadTask : public CTask {
    public:
        int process() override;
};  

class CWriteTask : public CTask {
    public:
        int process() override;
};  