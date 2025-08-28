#pragma once
#include<map>
#include<mutex>
#include"./msg_process.h"


class CMsgManage {

    public:
        static CMsgManage* getInstance();

   

        //char* getReadBuffer(int fd);
        //char* getWriteBuffer(int fd);

        CMsgProcessor* getProcessor(int fd);

    private:
        CMsgManage();


    private:
        std::map<int, CMsgProcessor*> msgmap_;
        std::mutex msgMux_;
};