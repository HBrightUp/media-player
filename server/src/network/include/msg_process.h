#pragma once
#include <filesystem> 
#include<vector>
#include"../../common/include/common.h"


const uint  MSG_HEADER_SIZE = 2;

class CMsgProcessor {

    public:
        CMsgProcessor();
        ~CMsgProcessor();

        char* getReader();
        char* getWriter();
        int getWriteDataLen();

        bool process();
    private:
        void getRandomList();

        bool login(const char* pdata);
        bool play_online_random(const char* pdata);
        bool hasExtension(const std::string& filename, const std::string& extension);
        std::vector<std::string> getFilesWithExtension(const std::string& dirPath, const std::string& extension);

        bool download_single_music(const char* pdata);

    private:
        char readbuf[MAX_BUFFER_READ_ONCE_TIME];
        char* writebuf;
        uint writenLen_;

};
