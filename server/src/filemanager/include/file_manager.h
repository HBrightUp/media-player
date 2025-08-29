#pragma once
#include<map>
#include<vector>


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
        
    private:
        std::string workspacePath_;
        std::map<std::string, std::string> musicMap_;

};