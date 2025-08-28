#ifndef UIMANAGE_H
#define UIMANAGE_H
#include<QScopedPointer>
#include<QObject>
#include"login.h"
#include"player.h"
#include"video.h"
#include"./tcpclient.h"
#include"./msg_assembly.h"
#include"./signals_type.h"

class UiManage:public QObject
{
    public:
        UiManage();

        void start();

    private slots:
        void login_message_rev(const SignalsType, const std::string&);
        void login_success_rev();
        //void player_message_rev(MessageType, std::string);
        void play_online_random_recv();
        void play_online_random_response_recv(const QVector<std::string>& musicList);


    private:

        QScopedPointer<Login> login_;
        QScopedPointer<Player> player_;
        QScopedPointer<Video> video_;
        QScopedPointer<TcpClient> client_;

        QString userName_;
};

#endif // UIMANAGE_H
