#pragma once
#include<map>
#include<mutex>
#include"./msg_process.h"


class CMsgManage {

    public:
        static CMsgManage* getInstance();

        CMsgProcessor* get_or_create_processor(const int& fd);
        void remove_processor(const int& fd);

    private:
        CMsgManage();

    private:
        std::map<int, CMsgProcessor*> msgmap_;
        std::mutex msgMux_;
};