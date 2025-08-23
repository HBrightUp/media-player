
file(GLOB HEADERS "../include/*.h" "../include/*.hpp" )

add_library( logger 
    log.cpp
    ${HEADERS}
)

