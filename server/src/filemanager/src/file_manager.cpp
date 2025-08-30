#include<iostream>
#include <vector>
#include<dirent.h>
#include<sys/stat.h>
#include <filesystem>
#include"../include/file_manager.h"
#include"../../logger/include/log.h"


CFileManager::CFileManager() {

    
}

CFileManager::~CFileManager() {

}

CFileManager& CFileManager::getInstance() {
    static CFileManager manager;

    return manager;
}

bool CFileManager::init() {
    
    if(!init_workspace()) {
        return false;
    }

    getFilesWithExtension(workspacePath_, ".mp3");
    print();

    return true;
}

 bool CFileManager::init_workspace() {
    const std::string work_path = "~/Downloads";  
    //workspacePath_.resize(PATH_MAX);

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
    std::cout << "print music list:" << std::endl;
    for (const auto& music : musicMap_) {
        std::cout << music.first << ", " << music.second << std::endl;
    }
}