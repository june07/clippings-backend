#!/bin/bash -x

BACKUP=backup
IMAGE=$1
SERVICE=$2
CONFIG=docker-stack

cd ~/june07/jc-backend

if [[ $SERVICE =~ ^jc-backend-dev ]]; then
        CONFIG=docker-stack-dev
fi
if [ ! -e $BACKUP ]; then
        mkdir $BACKUP
fi

# update ${CONFIG}.yml with new image version
cp ${CONFIG}.yml $BACKUP/${CONFIG}.yml-$(date | tr " " "_")
current=$(grep "image: ghcr.io" ${CONFIG}.yml | grep -v "#" | tail -1 | xargs)
echo "current: $current"
cat ${CONFIG}.yml | sed "s@$current@#$current\n    image: $IMAGE@" > .${CONFIG}.temp.yml
mv .${CONFIG}.temp.yml ${CONFIG}.yml

dockerlogin.sh && docker service update --update-failure-action rollback --image $IMAGE $SERVICE --with-registry-auth
echo "$(date): ../../dockerlogin.sh && docker service update --update-failure-action rollback --image $IMAGE $SERVICE --with-registry-auth" >> ./output.log