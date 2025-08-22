#include<iostream>
#include"./src/network/include/server.h"
#include"./src/common/include/common.h"



int main(int argc, char* argv[]) {


    std::cout << "Server start work." << std::endl;

    Server* s = Server::Instance();
    s->set_server_info(SERVER_IP, SERVER_PORT);
    s->run();



    

    return 0;
}