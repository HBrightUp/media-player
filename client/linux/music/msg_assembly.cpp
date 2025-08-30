#include<iostream>
#include<QDebug>
#include"./msg_assembly.h"
#include<QException>


std::string CMsgAssembly:: assembly(const media::MsgType type, const std::string& serialized) {
    std::string msg = std::to_string(static_cast<unsigned char>(type));
    msg.append(":");

    //uint32_t len = htonl(serialized.size());
    //msg.append(reinterpret_cast<char*>(&len), sizeof(len));

    msg.append(std::to_string(serialized.size()));
    msg.append(":");
    qInfo() << "msg: " << msg;

    msg.append(serialized);

    return msg;
}
