#include<iostream>
#include <vector>
#include<dirent.h>
#include<sys/stat.h>
#include <filesystem>
#include <sys/inotify.h>
#include <unistd.h>
#include"../include/file_manager.h"
#include"../../logger/include/log.h"


CFileManager::CFileManager() {
    exit_ = false;
    
}

CFileManager::~CFileManager() {
    if (monitorDir_.joinable()) {
        monitorDir_.join();
    }
}

CFileManager& CFileManager::getInstance() {
    static CFileManager manager;

    return manager;
}

bool CFileManager::init() {
    
    if(!init_workspace()) {
        return false;
    }

    monitorDir_ = std::thread(&CFileManager::mointor_music_directory, this);

    auto& log = Logger::getInstance();

    getFilesWithExtension(workspacePath_, ".mp3");
    //print();
    if (musicMap_.size() == 0) {
        log.print("music file not found,");
        return false;
    } 

    log.print("Total ites of current music: ", musicMap_.size());


    return true;
}

 bool CFileManager::init_workspace() {
    const std::string work_path = "~/Downloads";  
    workspacePath_ = expandHomeDirectory(work_path);

    return true;
 }

std::string CFileManager::expandHomeDirectory(const std::string& path) {
    if (path.empty()) {
        return path;
    }

    if (path[0] == '~') {
        const char* homeDir = getenv("HOME");
        if (homeDir == nullptr) {
            std::cerr << "HOME environment variable not set." << std::endl;
            return path; 
        }
        return std::string(homeDir) + path.substr(1); 
    }

    return path;  
}

bool CFileManager::hasExtension(const std::string& filename, const std::string& extension) {
    if (filename.length() >= extension.length()) {
        return (0 == filename.compare(filename.length() - extension.length(), extension.length(), extension));
    }
    return false;
}

std::vector<std::string> CFileManager::getFilesWithExtension(const std::string& dirPath, const std::string& extension) {
    std::vector<std::string> files;
    DIR* dir = opendir(dirPath.c_str());

    if (dir == nullptr) {
        std::cerr << "Unable to open directory: " << dirPath << std::endl;
        return files;
    }

    struct dirent* entry;
    while ((entry = readdir(dir)) != nullptr) {
        std::string filename = entry->d_name;
     
        if (filename == "." || filename == "..") {
            continue;
        }

        std::string fullPath = dirPath + "/" + filename;


        struct stat fileStat;
        if (stat(fullPath.c_str(), &fileStat) == 0) {
       
            if (S_ISREG(fileStat.st_mode) && hasExtension(filename, extension)) {
                //files.push_back(filename);
                musicMap_[filename] = fullPath;
            }
        }
    }

    closedir(dir);
    return files;
}

void CFileManager::print() {
    std::cout << "print music list" << std::endl;

    auto& log = Logger::getInstance();
    log.print("Current size of music: ", musicMap_.size());

    // for (const auto& music : musicMap_) {
    //     std::cout << music.first << ", " << music.second << std::endl;
    // }
}

void CFileManager::mointor_music_directory() {

    auto& log = Logger::getInstance();

    int fd = inotify_init();
    if (fd == -1) {
        log.print("Init inotify failed.");
        return ;
    }

    //const char* directory_to_watch = "/home/hml/Downloads";

    int watch_descriptor = inotify_add_watch(fd, workspacePath_.c_str(),
                                             IN_MODIFY | IN_CREATE | IN_DELETE | IN_MOVED_TO | IN_MOVED_FROM);
    if (watch_descriptor == -1) {
        log.print("Watch workspace failed.");
        return ;
    }

    char buffer[4096];

    log.print("start monitor music directory.");

    while (!exit_) {
        ssize_t length = read(fd, buffer, sizeof(buffer));
        if (length == -1) {
            log.print("Read fd of workspace directory failed.");
            return ;
        }

        for (ssize_t i = 0; i < length;) {
            struct inotify_event *event = (struct inotify_event *) &buffer[i];
            if (event->len) {
                if ((event->mask & IN_CREATE) && is_contain_music_suffix(event->name)) {
                    std::cout << "File created: " << event->name << std::endl;
                    musicMap_[event->name] = workspacePath_ + "/" + event->name;
                    print();
                }
                if ((event->mask & IN_DELETE) && is_contain_music_suffix(event->name)) {
                    std::cout << "File deleted: " << event->name << std::endl;
                     musicMap_.erase(event->name);
                    print();
                }
                if ((event->mask & IN_MODIFY) && is_contain_music_suffix(event->name)) {
                    std::cout << "File modified: " << event->name << std::endl;
                    musicMap_[event->name] = workspacePath_ + "/" + event->name;
                    print();
                }
                if ((event->mask & IN_MOVED_TO) && is_contain_music_suffix(event->name)) {
                    std::cout << "File moved to: " << event->name << std::endl;
                    musicMap_[event->name] = workspacePath_ + "/" + event->name;
                    print();
                }
                if ((event->mask & IN_MOVED_FROM) && is_contain_music_suffix(event->name)) {
                    std::cout << "File moved from: " << event->name << std::endl;
                    //musicMap_[event->name] = workspacePath_ + "/" + event->name;
                    musicMap_.erase(event->name);
                    print();
                }

                    
            }
            i += sizeof(struct inotify_event) + event->len;
        }

    }


    ::close(fd);

    return ;
}

bool CFileManager::is_contain_music_suffix(const char* filename) {
    if (filename == nullptr) {
        return false;
    }

    std::string name(filename);
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