#include<iostream>
#include"./src/network/include/server.h"
#include"./src/common/include/common.h"
#include"./src/logger/include/log.h"
#include"./src/filemanager/include/file_manager.h"

int main(int argc, char* argv[]) {

    CFileManager::getInstance().init();
    auto& log = Logger::getInstance();
    log.init("./logfile", LoggerMode::ENU_FILE); 

    if (argc < 2) {
        log.print("Listen port input required.");
        return -1;
    }

    unsigned short port = 0;
    try {
        port = std::atoi(argv[1]);
    } catch(const std::exception& e) {
        std::cerr << e.what() << '\n';
        log.print("Parse port failed, input port, ", e.what());
        return -1;
    }
    
    Server& s = Server::Instance();
    s.init(SERVER_IP, std::atoi(argv[1]));
    if(!s.start()) {
        log.print("Program startup failed.");
    }

    return 0;
}