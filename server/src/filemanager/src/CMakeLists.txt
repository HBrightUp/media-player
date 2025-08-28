
file(GLOB HEADERS "../include/*.h" "../include/*.hpp" )

add_library( filemanager 
    file_manager.cpp
    ${HEADERS}
)

