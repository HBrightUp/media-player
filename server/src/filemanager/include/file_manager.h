#pragma once
#include<map>
#include<vector>
#include<thread>


class CFileManager{

    public:
        static CFileManager& getInstance();
        ~CFileManager();

        bool init();
        void print();
        inline std::string filePath(std::string filename) { return musicMap_[filename];}

    private:
        CFileManager();
        bool init_workspace();
        std::string expandHomeDirectory(const std::string& path);
        bool hasExtension(const std::string& filename, const std::string& extension);
        std::vector<std::string> getFilesWithExtension(const std::string& dirPath, const std::string& extension);

        void mointor_music_directory();
        bool is_contain_music_suffix(const char* filename);
        
    private:
        std::string workspacePath_;
        std::map<std::string, std::string> musicMap_;
        std::thread monitorDir_;
        bool exit_;

};