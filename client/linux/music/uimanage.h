#ifndef UIMANAGE_H
#define UIMANAGE_H
#include<QScopedPointer>
#include<QObject>
#include"login.h"
#include"player.h"
#include"video.h"
#include"./tcpclient.h"
#include"downloadmusic.h"


class UiManage:public QObject
{
    public:
        UiManage();
        ~UiManage();

        void start();

    private slots:
        void login_message_rev(const std::string& msgLogin);
        void login_success_rev();

        void play_online_random_recv();
        void play_online_random_response_recv(const QVector<std::string>& musicList);

        void download_music_recv(const QString& musicName);
        void download_single_music_response_recv();

        void player_exit();

        void download_single_music();
        void start_download_recv();
        void start_download_with_timer();
    private:

        QScopedPointer<Login> login_;
        QScopedPointer<Player> player_;
        QScopedPointer<Video> video_;
        QSharedPointer<TcpClient> client_;

        QString userName_;
        QTimer* downloadTimer;

        QList<QString> downloadList_;
        QMutex  downloadListMux_;
        bool lockDownload_;
};

#endif // UIMANAGE_H
