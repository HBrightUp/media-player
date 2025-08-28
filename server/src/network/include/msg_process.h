#pragma once
#include <filesystem> 
#include"../../common/include/common.h"


const uint  MSG_HEADER_SIZE = 2;

class CMsgProcessor {

    public:
        CMsgProcessor();
        ~CMsgProcessor();

        char* getReader();
        char* getWriter();
        int getWriteDataLen();

        void process();
    private:
        void getRandomList();

        bool login(const char* pdata);
        bool play_online_random(const char* pdata);
    


    private:
        char readbuf[MAX_BUFFER_READ_ONCE_TIME];
        char writebuf[MAX_BUFFER_READ_ONCE_TIME];
        uint writenLen_;

};
