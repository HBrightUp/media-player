#include "downloadmusic.h"
#include<QDebug>

DownloadMusic::DownloadMusic(QObject *parent)
    : QThread{parent}
{}

void DownloadMusic::run() {
    qInfo() << "Download run" ;

    while(musicList_.size() > 0) {
        QMutexLocker<QMutex> readlock(&MuxList_);
        QString musicName = musicList_.first();
        readlock.unlock();


        media::DownloadSingleMusic singleMusic;
        singleMusic.set_username(username_.toStdString());
        singleMusic.set_musicname(musicName.toStdString());

        std::string serialized;
        singleMusic.SerializeToString(&serialized);

        CMsgAssembly ass;
        std::string msgdata = ass.assembly(media::MsgType::ENU_DOWNLOAD_SINGLE_MUSIC, serialized);

        qInfo() << "send message of download single music to server, size: " << msgdata.size();
        client_->writeData(msgdata);

        ConditionList_.wait(&MuxList_);

        QMutexLocker<QMutex> poplock(&MuxList_);
        musicList_.pop_front();
        poplock.unlock();
    }

}

void DownloadMusic::update_music_list(const QSharedPointer<TcpClient>& client, const QString& music_name, const QString& username) {
    QMutexLocker<QMutex> lock(&MuxList_);
    musicList_.append(music_name);
    client_ = client;
    username_ = username;
}


void DownloadMusic::download_single_music_response_recv() {
    ConditionList_.notify_one();
}
