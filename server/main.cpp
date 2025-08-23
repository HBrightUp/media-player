#include<iostream>
#include"./src/network/include/server.h"
#include"./src/common/include/common.h"
#include"./src/logger/include/log.h"






int main(int argc, char* argv[]) {

    if (argc < 2) {
        return 0;
    }

    Server& s = Server::Instance();
    s.init(SERVER_IP, std::atoi(argv[1]));
    if(!s.start()) {
        Logger::getInstance().print("Program startup failed.");
    }

    return 0;
}