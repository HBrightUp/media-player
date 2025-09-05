#include "MonitorDir.h"
#include <sys/inotify.h>
#include <unistd.h>
#include <cstdlib>
#include <cstring>
#include<QDebug>
#include<QDir>

Worker::Worker() {
    exit_ = false;
}
void Worker:: run() {
    int fd = inotify_init();
    if (fd == -1) {
        qInfo() << "inotify_init failed";
        return ;
    }

    //const char* directory_to_watch = musicDir_.toLocal8Bit().constData();
    const char* directory_to_watch = "/home/hml/Music";
    qInfo() << "direcotory watch: " << directory_to_watch;
    int watch_descriptor = inotify_add_watch(fd, directory_to_watch,
                                             IN_MODIFY | IN_CREATE | IN_DELETE | IN_MOVED_TO | IN_MOVED_FROM);
    if (watch_descriptor == -1) {
        qInfo() << "inotify_add_watch failed";
        return ;
    }

    char buffer[4096];

    qInfo() << "start monitor music directory.";
    while (!exit_) {
        ssize_t length = read(fd, buffer, sizeof(buffer));
        if (length == -1) {
            qInfo() << "read failed" ;
            return ;
        }

        bool is_dir_change = false;
        for (ssize_t i = 0; i < length;) {
            struct inotify_event *event = (struct inotify_event *) &buffer[i];
            if (event->len) {
                if (event->mask & IN_CREATE) {
                    qInfo() << "File created: " << event->name;
                    is_dir_change = true;
                }
                if (event->mask & IN_DELETE) {
                    qInfo() << "File deleted: " << event->name;
                    is_dir_change = true;
                }
                if (event->mask & IN_MODIFY) {
                    qInfo() << "File modified: " << event->name;
                    is_dir_change = true;
                }
                if (event->mask & IN_MOVED_TO) {
                    qInfo() << "File moved to: " << event->name;
                    is_dir_change = true;
                }
                if (event->mask & IN_MOVED_FROM) {
                    qInfo() << "File moved from: " << event->name ;
                    is_dir_change = true;
                }

                if (is_dir_change && is_contain_music_suffix(event->name)) {
                    qInfo("music file changed.");
                    //update_player_list(QDir::homePath() + "/Music");
                    emit update_current_player_list();
                    break;

                }


            }
            i += sizeof(struct inotify_event) + event->len;
        }

    }


    ::close(fd);
}


bool Worker::is_contain_music_suffix(const char* filename) {
    if (filename == nullptr) {
        return false;
    }

    std::string name(filename);
    qInfo()<< "name: " << name;

    bool is_contain = false;

    size_t pos = name.rfind('.');
    if( pos != std::string::npos &&  pos + 1 < name.length()) {
        std::string suffix = name.substr(pos + 1);
        if (suffix == "mp3") {
            is_contain = true;
        }

    }

    return is_contain;
}

void Worker::notify_exit() {
    exit_ = true;
}
