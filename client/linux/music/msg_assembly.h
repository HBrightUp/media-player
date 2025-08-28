#ifndef MSG_ASSEMBLY_H
#define MSG_ASSEMBLY_H
#include<iostream>
#include"./music.pb.h"


// enum MessageType {
//     LOGIN = 0,
//     REQEST_MUSIC_LIST = 1,
//     DOWN_ONE_MUSIC = 2,
// };



class CMsgAssembly {
    public:
        CMsgAssembly()  = default;
        ~CMsgAssembly()  = default;


    public:
        std::string assembly(const media::MsgType type, const std::string& serialized_data);
};






#endif // MSG_ASSEMBLY_H
