const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp(functions.config().firebase);
const GeoFire = require('geofire');
const geoFire = new GeoFire(admin.database().ref("Meets"));
var firestoreDb = admin.firestore();
var Promise = require("bluebird");

// userFacebookId equals facebookId


exports.createNearbyMeetsToRTDB = functions.firestore.document('Meets/{meetId}').onCreate(event => {
    var newDoc = event.data.data();
    const theMeetId = event.params.meetId;
    var allowPeopleNearby = newDoc.allowPeopleNearby;
    if(allowPeopleNearby){
        var coordinate = newDoc.place.coordinate;
        //console.log(coordinate);
        var lat = coordinate.lat;
        var lng = coordinate.lng;
        return geoFire.set(theMeetId, [lat, lng]).then(function() {
            console.log(theMeetId + " has been added to GeoFire");
        }, function(error) {
            console.log("Error: " + error);
        });
    }
    return 0;
});

exports.deleteNearbyMeetsOfRTDB = functions.firestore.document('Meets/{meetId}').onDelete(event => {
    var newDoc = event.data.previous.data();
    const theMeetId = event.params.meetId;
    //console.log('inside delete fn');
    //console.log('meetId', theMeetId);
    var allowPeopleNearby = newDoc.allowPeopleNearby;
    if(allowPeopleNearby){
        return geoFire.remove(theMeetId).then(function() {
            console.log(theMeetId + "key has been removed from GeoFire");
        }, function(error) {
            console.log("Error: " + error);
        });
    }
    return 0;
});


exports.removeExpiredMeets = functions.https.onRequest((req, res) => {
    return firestoreDb.collection('Meets').get()
        .then((snapshot) => {
            snapshot.forEach((doc) => {
                var meet = doc.data();
                var meetId = doc.id;
                var startTime = new Date(meet.startTime);
                var timeNow = new Date();
                var isExpired = startTime < timeNow;
                //console.log(doc.id, '=>', doc.data(), ' startTime: ', startTime, 'timeNow: ', timeNow, ' result: ', compare);
                if(isExpired){
                    meet.status = false;
                    firestoreDb.collection('ExpiredMeets').doc(meetId).set(meet);
                    firestoreDb.collection('Meets').doc(meetId).delete();
                }
            });
            res.status(200).send('ok');
        })
        .catch((err) => {
            console.log('Error getting documents', err);
            res.status(500).send('error');
        });
});


exports.participateMeet = functions.https.onRequest((req,res) => {
    //console.log('get in participateMeet');
    //console.log(req.body);
    const userUid =req.body.userUid;
    //console.log('userFacebookId: ' + userFacebookId);
    const meetId = req.body.meetId;
    //console.log('meetId: ' + meetId);
    var meetRef = firestoreDb.collection('Meets').doc(meetId);
    return meetRef.get().then(doc => {
        if (!doc.exists) {
            console.log('No such document!');
            res.status(500).send('error');
        } else {
            //console.log('Document data:', doc.data());
            var meet = doc.data();
            var participatingUsersListDic = meet.participatingUsersList;
            var creatorUid = meet.creator;
            var timeDic = participatingUsersListDic[creatorUid];
            participatingUsersListDic[userUid] = timeDic;
            let maxNo = meet.maxNo;
            let parNo = Object.keys(meet.participatingUsersList).length;
            let notFull = (parNo < maxNo) || (maxNo===1);
            if(!notFull){
                let selectedFriendsDic = meet.selectedFriendsList;
                meetRef.update({
                    participatingUsersList: participatingUsersListDic,
                    selectedFriendsList:{},
                    backupSelectedFriendsList:selectedFriendsDic,
                    status:false,
                });
            } else {
                meetRef.update({participatingUsersList: participatingUsersListDic});
            }
            res.status(200).send('ok');
        }
    })
        .catch(err => {
            console.log('Error getting document', err);
            res.status(500).send('error');
        });

});


exports.leaveMeet = functions.https.onRequest((req,res) => {
    const userUid = req.body.userUid;
    //console.log('userFacebookId: ' + userFacebookId);
    const meetId = req.body.meetId;
    //console.log('meetId: ' + meetId);
    var meetRef = firestoreDb.collection('Meets').doc(meetId);
    return meetRef.get().then(doc => {
        if (!doc.exists) {
            //console.log('No such document!');
            res.status(500).send('error');
        } else {
            //console.log('Document data:', doc.data());
            var meet = doc.data();
            var participatingUsersListDic = meet.participatingUsersList;
            var creatorUid = meet.creator;
            if(creatorUid == userUid){
                res.status(500).send('Tinko Creator cannot leave');
            } else {
                delete participatingUsersListDic[userUid];
                let status = meet.status;
                if(status){

                    meetRef.update({participatingUsersList: participatingUsersListDic});
                    res.status(200).send('ok');
                } else {
                    // if status is false, compare endTime with now.
                    // of endTime < now, do the same thing,
                    // otherwise, put backupSelectedFriendsList back, set status = true
                    let endTime = meet.endTime;
                    let now = new Date();
                    let maxNo = meet.maxNo;
                    let parNo = Object.keys(meet.participatingUsersList).length;
                    let notFull = (parNo < maxNo) || (maxNo===1);
                    if(now<endTime && notFull){
                        let backupSelectedFriendsDic = meet.backupSelectedFriendsList;
                        meetRef.update({
                            participatingUsersList: participatingUsersListDic,
                            selectedFriendsList: backupSelectedFriendsDic,
                            backupSelectedFriendsList:{},
                            status:true,
                        });
                        res.status(200).send('ok');
                    }else{
                        meetRef.update({participatingUsersList: participatingUsersListDic});
                        res.status(200).send('ok');
                    }

                }

            }
        }
    })
        .catch(err => {
            console.log('Error getting document', err);
            res.status(500).send('error');
        });

});


exports.checkMeetStatus = functions.https.onRequest((req,res) => {
    const meetId = req.body.meetId;
    const isPrivacyStateChanged = req.body.isPrivacyStateChanged;
    const deletedList = req.body.deletedList;
    const newAddedList = req.body.newAddedList;
    //console.log('meetId: ' + meetId);
    //console.log('isPrivacyStateChanged',isPrivacyStateChanged);
    var meetRef = firestoreDb.collection('Meets').doc(meetId);
    return meetRef.get().then(doc => {
        if (!doc.exists) {
            //console.log('No such document!');
            res.status(500).send('error');
        } else {
            //console.log('Document data:', doc.data());
            var meet = doc.data();

            let pr1, pr2;

            // if(isPrivacyStateChanged){
            //     var allowPeopleNearby = meet.allowPeopleNearby;
            //     if(allowPeopleNearby){
            //         var coordinate = meet.place.coordinate;
            //         //console.log(coordinate);
            //         var lat = coordinate.lat;
            //         var lng = coordinate.lng;
            //         pr1 = geoFire.set(meetId, [lat, lng]).then(function() {
            //             console.log(meetId + " has been added to GeoFire");
            //         }, function(error) {
            //             console.log("Error: " + error);
            //         });
            //     }else{
            //         pr1 = geoFire.remove(meetId).then(function() {
            //             console.log(meetId + "key has been removed from GeoFire");
            //           }, function(error) {
            //             console.log("Error: " + error);
            //           });
            //     }
            // }


            //var allowPeopleNearby = meet.allowPeopleNearby;
            let status = meet.status;
            let dismissed = meet.dismissed;
            let selectedList;
            if(status){
                selectedList=meet.selectedFriendsList;
            } else{
                selectedList = meet.backupSelectedFriendsList;
            }

            if(deletedList){
                deletedList.map((uid)=>{
                    delete selectedList[uid];
                });
            }

            if(newAddedList){
                let timeStatusDic = meet.participatingUsersList[meet.creator];
                newAddedList.map((uid)=>{
                    selectedList[uid]=timeStatusDic;
                });
            }

            let allowPeopleNearby = meet.allowPeopleNearby;
            let endTime = meet.endTime;
            let now = new Date();
            let maxNo = meet.maxNo;
            let parNo = Object.keys(meet.participatingUsersList).length;
            let notFull = (parNo < maxNo) || (maxNo===1);
            if (now < endTime && notFull && !dismissed){
                //console.log('both true')
                if(allowPeopleNearby){
                    let coordinate = meet.place.coordinate;
                    //console.log(coordinate);
                    let lat = coordinate.lat;
                    let lng = coordinate.lng;
                    pr1 = geoFire.set(meetId, [lat, lng]).then(function() {
                        console.log(meetId + " has been added to GeoFire");
                    }, function(error) {
                        console.log("Error: " + error);
                    });
                }else{
                    pr1 = geoFire.remove(meetId).then(function() {
                        console.log(meetId + "key has been removed from GeoFire");
                    }, function(error) {
                        console.log("Error: " + error);
                    });
                }
                pr2 = meetRef.update({
                    status: true,
                    selectedFriendsList:selectedList,
                    backupSelectedFriendsList:{}
                });
            } else {
                //console.log('some false')
                pr1 = geoFire.remove(meetId).then(function() {
                    console.log(meetId + "key has been removed from GeoFire");
                }, function(error) {
                    console.log("Error: " + error);
                });
                pr2 = meetRef.update({
                    selectedFriendsList: {},
                    backupSelectedFriendsList:selectedList,
                    status:false,
                });
            }
            return Promise.all([pr1,pr2]).then(()=>{
                res.status(200).send('ok');
            }).catch(err => {
                console.log('Error', err);
                res.status(500).send('error');
            });
        }
    })
        .catch(err => {
            console.log('Error getting document', err);
            res.status(500).send('error');
        });

});




exports.initializeNewUser = functions.https.onRequest((req,res) => {
    const linkFacebookMode = req.body.linkFacebookMode;
    const facebookId = req.body.id;
    const name = req.body.name;
    const email = req.body.email;
    const uid = req.body.uid;
    const fbToken = req.body.fbToken;
    const fbTokenExpires = req.body.fbTokenExpires;
    let friendsList = req.body.friends.data;
    //const photoURL = req.body.picture.data.url;
    var location;
    if (req.body.location === undefined){
        location = "";
    } else {
        location = req.body.location.name;
    }
    var gender;
    if(req.body.gender === undefined){
        gender = "";
    } else {
        gender = req.body.gender;
    }
    //console.log('facebookId', facebookId);

    var userRef = firestoreDb.collection('Users').doc(uid);

    if(linkFacebookMode){
        const originalUserData = req.body.userData;
        let userData = {};
        userData.facebookId=facebookId;
        if(originalUserData.email.includes(originalUserData.username)){
            userData.username = name;
        }
        if(originalUserData.photoURL==='https://firebasestorage.googleapis.com/v0/b/tinko-64673.appspot.com/o/Users%2FAvatar%2Favatar-placeholder.png?alt=media&token=68f12225-4266-4888-8aaa-98315112c2ed'){
            userData.photoURL=`https://graph.facebook.com/${facebookId}/picture?type=normal`;
        }
        if(gender===''){
            userData.gender=gender;
        }
        if(location===''){
            userData.location=location;
        }
        userData.fbAutoAdd=true;
        let userPhoneNumber = originalUserData.phoneNumber;
        return userRef.update(userData).then(()=>{
            return userRef.collection('Settings').doc('secrets').set({fbToken:fbToken, fbTokenExpires:fbTokenExpires})
                .then(()=>{
                    let pr1 = updateInfoToAllMyFriends(uid,'facebook',facebookId);
                    let pr2 = Promise.map(friendsList, function (friendInfo){
                        let friendFacebookId = friendInfo.id;
                        initializeFriendShip(friendFacebookId, uid,facebookId, userPhoneNumber);
                    });
                    //     .then(()=>{
                    //     res.status(200).send('ok');
                    // });
                    return Promise.all([pr1,pr2]).then(()=>res.status(200).send('ok'));

                })
                .catch((error)=>console.log(error));
        })

    }else{
        let userData = {
            facebookId : facebookId,
            username: name,
            email: email,
            uid: uid,
            photoURL: `https://graph.facebook.com/${facebookId}/picture?type=normal`,
            gender: gender,
            location: location,
            fbAutoAdd:true
        };
        return userRef.set(userData).then(ref => {

            return userRef.collection('Settings').doc('secrets').set({fbToken:fbToken, fbTokenExpires:fbTokenExpires})
                .then(()=>{
                    //console.log('Added document with ID: ', ref.id);
                    //console.log('friendsList: ', friendsList);
                    //friendsList:  [ { id: [ '1503367089694364', '107771053169905' ],name: [ 'Xue Donghua', 'Kevin Schrute' ] } ]
                    // var friendsIdList = friendsList[0].id;
                    // console.log('friendsIdList: ', friendsIdList);
                    //FOR LOOP for Friends adding operation
                    Promise.map(friendsList, function (friendInfo){
                        let friendFacebookId = friendInfo.id;
                        initializeFriendShip(friendFacebookId, uid,facebookId);
                    }).then(()=>{
                        res.status(200).send('ok');
                    });
                })
                .catch((error)=>console.log(error));
        }).catch(err => {
            console.log('Error getting documents', err);
        });
    }
});

function initializeFriendShip(friendFacebookId,uid, facebookId, phoneNumber){
    //console.log('friendFacebookId: ', friendFacebookId);
    let usersColRef = firestoreDb.collection('Users');
    let userRef = usersColRef.doc(uid);
    //var friendDocRef = firestoreDb.collection('Users').doc(friendFacebookId);

    return usersColRef.where('facebookId', '==', friendFacebookId).get()
        .then(snapshot => {
            // if(!snapshot.empty){
            //     console.log(friendFacebookId + ' exists');

            // } else {
            //     console.log(friendFacebookId + ' does not exist');
            // }
            snapshot.forEach(doc => {
                console.log(doc.id, '=>', doc.data());
                let friendUid = doc.id;
                let friendDocRef = usersColRef.doc(friendUid);
                //IF fbAutoAdd is true, doing so and send newFriendsRequest type 2, if fbAutoAdd is false, send newFriendsRequest type 0
                let friendFBAutoAdd = doc.data().fbAutoAdd;
                let promises = [];
                if(friendFBAutoAdd){
                    let friendPhoneNumber = doc.data().phoneNumber;
                    if(!friendPhoneNumber){
                        friendPhoneNumber={}
                    }
                    let userPhoneNumber = phoneNumber;
                    if(!userPhoneNumber){
                        userPhoneNumber={}
                    }

                    //my ref add friend facebookId
                    console.log('friendUid', friendUid);
                    const pr1 = userRef.collection('Friends_List').doc(friendUid)
                        .set({uid:friendUid, facebookId:friendFacebookId, phoneNumber:friendPhoneNumber}).catch(err => {
                            console.log('Error getting documents', err);
                        });
                    //friend ref add my facebookId
                    console.log('uid', uid);
                    const pr2 = friendDocRef.collection('Friends_List').doc(uid)
                        .set({uid:uid, facebookId:facebookId,phoneNumber:userPhoneNumber}).catch(err => {
                            console.log('Error getting documents', err);
                        });
                    //my newFriendsRequestRef add friend type2 request
                    const pr3 = userRef.collection('NewFriendsRequest').doc(friendUid)
                        .set({
                            requester:friendUid,
                            responser:uid,
                            type:2,
                            msg:'',
                            timestamp:new Date().getTime(),
                        }).catch((error) => console.log(error));
                    //friend newFriendsRequestRef add user type2 request
                    const pr4 = friendDocRef.collection('NewFriendsRequest').doc(uid)
                        .set({
                            requester:uid,
                            responser:friendUid,
                            type:2,
                            msg:'',
                            timestamp:new Date().getTime(),
                        }).catch((error) => console.log(error));
                    //add user to friends meet if allFriends = true
                    console.log('afterwords');
                    var meetsRef = firestoreDb.collection('Meets');
                    var meetsQueryRef = meetsRef.where('creator', '==', friendUid).where('status','==',true);
                    const pr5 = meetsQueryRef.get().then(snapshot => {
                        var batch = firestoreDb.batch();
                        snapshot.forEach(doc => {
                            console.log(doc.id, '=>', doc.data());
                            //modify meet selectedFriendsList
                            var meet = doc.data();
                            var allFriends = meet.allFriends;
                            let status = meet.status;
                            if(allFriends && status){
                                var timeDoc = meet.participatingUsersList[friendUid];
                                var selectedFriendsDoc = meet.selectedFriendsList;
                                selectedFriendsDoc[uid] = timeDoc;
                                var meetRef = meetsRef.doc(doc.id);
                                batch.update(meetRef, {selectedFriendsList:selectedFriendsDoc});
                                // return meetsRef.doc(doc.id).update({selectedFriendsList:selectedFriendsDoc}).catch(err => {
                                //     console.log('Error updating documents', err);
                                // });
                            }
                        });
                        return batch.commit().catch(err => {
                            console.log('Error getting documents', err);
                        });
                    }).catch(err => {
                        console.log('Error getting documents', err);
                    });
                    //add friend to user's meet if allFriends = true
                    var userMeetsQueryRef = meetsRef.where('creator', '==', uid).where('status','==',true);
                    const pr6 = userMeetsQueryRef.get().then(snapshot => {
                        var batch = firestoreDb.batch();
                        snapshot.forEach(doc => {
                            console.log(doc.id, '=>', doc.data());
                            //modify meet selectedFriendsList
                            var meet = doc.data();
                            var allFriends = meet.allFriends;
                            let status = meet.status;
                            if(allFriends && status){
                                var timeDoc = meet.participatingUsersList[uid];
                                var selectedFriendsDoc = meet.selectedFriendsList;
                                selectedFriendsDoc[friendUid] = timeDoc;
                                var meetRef = meetsRef.doc(doc.id);
                                batch.update(meetRef, {selectedFriendsList:selectedFriendsDoc});
                                // return meetsRef.doc(doc.id).update({selectedFriendsList:selectedFriendsDoc}).catch(err => {
                                //     console.log('Error updating documents', err);
                                // });
                            }
                        });
                        return batch.commit().catch(err => {
                            console.log('Error getting documents', err);
                        });
                    }).catch(err => {
                        console.log('Error getting documents', err);
                    });
                    promises = [pr1,pr2,pr3,pr4,pr5,pr6];
                } else {
                    const pr1 = friendDocRef.collection('NewFriendsRequest').doc(uid)
                        .set({
                            requester:uid,
                            responser:friendUid,
                            type:0,
                            msg:'I am on Tinko now! (Friend Request by system)',
                            timestamp:new Date().getTime(),
                        }).catch((error) => console.log(error));
                    promises=[pr1]
                }

                return Promise.all(promises);
            });
        })
        .catch(err => {
            console.log('Error getting documents', err);
        });
}

function updateInfoToAllMyFriends(uid,code,data){
    let userFriendsList = firestoreDb.collection('Users').doc(uid).collection('Friends_List');
    userFriendsList.get().then(function(querySnapshot) {
        var batch = firestoreDb.batch();
        querySnapshot.forEach(function(doc) {
            // doc.data() is never undefined for query doc snapshots
            console.log(doc.id, " => ", doc.data());
            let friendUid = doc.id;
            let friendFriendsListOfMe = firestoreDb.collection('Users').doc(friendUid).collection('Friends_List').doc(uid);
            if(code==='facebook'){
                batch.update(friendFriendsListOfMe,{facebookId:data});
            }else{
                batch.update(friendFriendsListOfMe,{phoneNumber:data});
            }

        });
        return batch.commit().catch(err => {
            console.log('Error batch commit', err);
        });
    });
}

exports.linkPhoneNumber = functions.https.onRequest((req,res)=>{
    let uid = req.body.uid;
    let phoneNumber = req.body.phoneNumber;
    let countryCode = req.body.countryCode;
    let userRef = firestoreDb.collection('Users').doc(uid);
    let data = {number:phoneNumber,countryCode:countryCode};
    return userRef.update({phoneNumber:data}).then(()=>{
        updateInfoToAllMyFriends(uid,'phoneNumber',data);
        res.status(200).send('ok');
    }).catch(err => {
        console.log('Error', err);
        res.status(500).send('error');
    });

});

exports.sendAddFriendRequest = functions.https.onRequest((req,res) => {
    const requester = req.body.requester;
    const responsor = req.body.responsor;
    const requestMessage = req.body.requestMessage;
    console.log('requester: ', requester, ' responsor: ', responsor);
    //Send a notification
    //Create a doc in NewFriendFolder
    var addFriendRequestRef = firestoreDb.collection('Users').doc(responsor)
        .collection('NewFriendsFolder').doc(requester);
    return addFriendRequestRef.get()
        .then(doc => {
            if (!doc.exists) {
                //console.log('No such document!');
                var requestDic = {
                    requester: requester,
                    responsor: responsor,
                    requestTime: Date.now(),
                    type:0,
                    read:false,
                    requestMessage:requestMessage
                }
                return addFriendRequestRef.set(requestDic).then(()=>{
                    res.status(200).send('ok');
                }).catch(err => {
                    console.log('Error getting documents', err);
                    res.status(500).send('error');
                });
            } else {
                //console.log('Document data:', doc.data());
                res.status(200).send('ok');
            }
        })
        .catch(err => {
            console.log('Error getting document', err);
            res.status(500).send('error');
        });
});


exports.initializeTwoWayFriendship = functions.https.onRequest((req,res) => {
    const friendUid = req.body.requester;
    const userUid = req.body.responser;
    const userFacebookId = req.body.requesterFacebookId;
    let userPhoneNumber = req.body.requesterPhoneNumber;
    if(!userPhoneNumber){
        userPhoneNumber={};
    }
    var userRef = firestoreDb.collection('Users').doc(userUid);
    var friendDocRef = firestoreDb.collection('Users').doc(friendUid);
    return friendDocRef.get().then(doc => {
        if(doc.exists){
            let friendFacebookId = doc.data().facebookId;
            let friendPhoneNumber = doc.data().phoneNumber;
            if(!friendPhoneNumber){
                friendPhoneNumber={};
            }
            //my ref add friend facebookId
            const pr1 = userRef.collection('Friends_List').doc(friendUid)
                .set({uid:friendUid,facebookId:friendFacebookId,phoneNumber:friendPhoneNumber}).catch(err => {
                    console.log('Error getting documents', err);
                });
            //friend ref add my facebookId
            const pr2 = friendDocRef.collection('Friends_List').doc(userUid)
                .set({uid:userUid,facebookId:userFacebookId,phoneNumber:userPhoneNumber}).catch(err => {
                    console.log('Error getting documents', err);
                });
            //user send accept receipt to friend
            const pr5 = friendDocRef.collection('NewFriendsRequest').doc(userUid)
                .set({
                    requester:userUid,
                    responser:friendUid,
                    type:1,
                    msg:'',
                    timestamp:new Date().getTime(),
                }).catch((error) => console.log(error));
            // set accept to user's newFriendsRequest request
            const pr6 = userRef.collection('NewFriendsRequest').doc(friendUid).update({type:1})
                .catch((error) => console.log(error));
            //add user to friends meet if allFriends = true
            var meetsRef = firestoreDb.collection('Meets');
            var friendMeetsQueryRef = meetsRef.where('creator', '==', friendUid).where('status','==',true);
            const pr3 = friendMeetsQueryRef.get().then(snapshot => {
                var batch = firestoreDb.batch();
                snapshot.forEach(doc => {
                    //console.log(doc.id, '=>', doc.data());
                    //modify meet selectedFriendsList
                    var meet = doc.data();
                    var allFriends = meet.allFriends;
                    let status = meet.status;
                    if(allFriends && status){
                        var timeDoc = meet.participatingUsersList[friendUid];
                        var selectedFriendsDoc = meet.selectedFriendsList;
                        selectedFriendsDoc[userUid] = timeDoc;
                        var meetRef = meetsRef.doc(doc.id);
                        batch.update(meetRef, {selectedFriendsList:selectedFriendsDoc});
                        // return meetsRef.doc(doc.id).update({selectedFriendsList:selectedFriendsDoc}).catch(err => {
                        //     console.log('Error updating documents', err);
                        // });
                    }
                });
                return batch.commit().catch(err => {
                    console.log('Error getting documents', err);
                });
            }).catch(err => {
                console.log('Error getting documents', err);
            });

            //add friends to users meet if allFriends = true
            var userMeetsQueryRef = meetsRef.where('creator', '==', userUid).where('status','==',true);
            const pr4 = userMeetsQueryRef.get().then(snapshot => {
                var batch = firestoreDb.batch();
                snapshot.forEach(doc => {
                    //console.log(doc.id, '=>', doc.data());
                    //modify meet selectedFriendsList
                    var meet = doc.data();
                    var allFriends = meet.allFriends;
                    let status = meet.status;
                    if(allFriends && status){
                        var timeDoc = meet.participatingUsersList[userUid];
                        var selectedFriendsDoc = meet.selectedFriendsList;
                        selectedFriendsDoc[friendUid] = timeDoc;
                        var meetRef = meetsRef.doc(doc.id);
                        batch.update(meetRef, {selectedFriendsList:selectedFriendsDoc});
                    }
                });
                return batch.commit().catch(err => {
                    console.log('Error getting documents', err);
                });
            }).catch(err => {
                console.log('Error getting documents', err);
            });
            //const pr5 = sendAddFriendRequestAcceptedReceipt(facebookId,friendFacebookId);
            return Promise.all([pr1,pr2,pr3,pr4,pr5,pr6]).then(()=>{
                res.status(200).send('ok');
                //return sendAddFriendRequestAcceptedReceipt(facebookId,friendFacebookId);
            }).catch(err => {
                console.log('Error', err);
                res.status(500).send('error');
            });;
        }else {
            console.log('Doc does not exist', err);
            res.status(500).send('error');
        }
    }).catch(err => {
        console.log('Error', err);
        res.status(500).send('error');
    });
});

function sendAddFriendRequestAcceptedReceipt(fromFacebookId, toFacebookId){
    const requestMessage = 'Friend Request Accepted';
    //Send a notification
    //Create a doc in NewFriendFolder
    var addFriendRequestRef = firestoreDb.collection('Users').doc(toFacebookId)
        .collection('NewFriendsFolder').doc(fromFacebookId);
    return addFriendRequestRef.get()
        .then(doc => {
            if (!doc.exists) {
                //console.log('No such document!');
                var requestDic = {
                    requester: fromFacebookId,
                    responsor: toFacebookId,
                    requestTime: Date.now(),
                    type:1,
                    read:false,
                    requestMessage:requestMessage
                }
                return addFriendRequestRef.set(requestDic).catch(err => {
                    console.log('Error getting documents', err);
                });
            }
        })
        .catch(err => {
            console.log('Error getting document', err);
        });
}


exports.malfunctionFunction = functions.https.onRequest((req,res) => {
    var batch = firestoreDb.batch();
    var meetsRef = firestoreDb.collection('Meets');
    meetsRef.get()
        .then(snapshot => {
            snapshot.forEach(doc => {
                console.log(doc.id, '=>', doc.data());
                let meet = doc.data();
                let meetId = doc.id;
                let participatingUsersList = meet.participatingUsersList;
                let participatingUsersArray = Object.keys(participatingUsersList);
                let meetRef = meetsRef.doc(meetId);
                batch.update(meetRef, {participatingUsersArray:participatingUsersArray});
            });
            return batch.commit().then(()=>{
                res.status(200).send('ok');
            })
        })
        .catch(err => {
            console.log('Error getting documents', err);
        });

});

exports.checkAllMeetsStatus = functions.https.onRequest((req,res)=>{
    let meetsRef = firestoreDb.collection('Meets').where('status','==', true).where('endTime','<',new Date());
    meetsRef.get()
        .then(snapshot => {
            let promises = [];
            snapshot.forEach(doc => {
                //console.log(doc.id, '=>', doc.data());
                let meetId = doc.id;
                let meetRef = firestoreDb.collection('Meets').doc(meetId);
                let pr1, pr2;
                let meet = doc.data();
                let status = meet.status;
                let dismissed = meet.dismissed;
                let selectedList;
                if(status){
                    selectedList=meet.selectedFriendsList;
                } else{
                    selectedList = meet.backupSelectedFriendsList;
                }

                let allowPeopleNearby = meet.allowPeopleNearby;
                let endTime = meet.endTime;
                let now = new Date();
                let maxNo = meet.maxNo;
                let parNo = Object.keys(meet.participatingUsersList).length;
                let notFull = (parNo < maxNo) || (maxNo===1);
                if (now < endTime && notFull && !dismissed){
                    //console.log('both true')
                    if(allowPeopleNearby){
                        let coordinate = meet.place.coordinate;
                        //console.log(coordinate);
                        let lat = coordinate.lat;
                        let lng = coordinate.lng;
                        pr1 = geoFire.set(meetId, [lat, lng]).then(function() {
                            console.log(meetId + " has been added to GeoFire");
                        }, function(error) {
                            console.log("Error: " + error);
                        });
                    }else{
                        pr1 = geoFire.remove(meetId).then(function() {
                            console.log(meetId + "key has been removed from GeoFire");
                        }, function(error) {
                            console.log("Error: " + error);
                        });
                    }
                    pr2 = meetRef.update({
                        status: true,
                        selectedFriendsList:selectedList,
                        backupSelectedFriendsList:{}
                    });
                } else {
                    //console.log('some false')
                    pr1 = geoFire.remove(meetId).then(function() {
                        console.log(meetId + "key has been removed from GeoFire");
                    }, function(error) {
                        console.log("Error: " + error);
                    });
                    pr2 = meetRef.update({
                        selectedFriendsList: {},
                        backupSelectedFriendsList:selectedList,
                        status:false,
                    });
                }
                promises.push(pr1,pr2);

            });
            return Promise.all(promises).then(()=>{
                res.status(200).send('ok');
            }).catch(err => {
                console.log('Error', err);
                res.status(500).send('error');
            });

        })
        .catch(err => {
            console.log('Error getting documents', err);
            res.status(500).send('error');
        });
});

exports.imageCacheTest = functions.https.onRequest((req,res) => {
    let data=[
        {
            imageName:"Beautiful Image one",
            imageUri:"https://s-media-cache-ak0.pinimg.com/736x/b1/21/df/b121df29b41b771d6610dba71834e512.jpg"
        },
        {
            imageName:"Beautiful Image one",
            imageUri:"https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTQpD8mz-2Wwix8hHbGgR-mCFQVFTF7TF7hU05BxwLVO1PS5j-rZA"
        },
        {
            imageName:"Beautiful Image one",
            imageUri:"https://s-media-cache-ak0.pinimg.com/736x/04/63/3f/04633fcc08f9d405064391bd80cb0828.jpg"
        },
        {
            imageName:"Beautiful Image one",
            imageUri:"https://encrypted-tbn1.gstatic.com/images?q=tbn:ANd9GcQRWkuUMpLyu3QnFu5Xsi_7SpbabzRtSis-_QhKas6Oyj3neJoeug"
        },
        {
            imageName:"Beautiful Image one",
            imageUri:"https://s-media-cache-ak0.pinimg.com/736x/a5/c9/43/a5c943e02b1c43b5cf7d5a4b1efdcabb.jpg"
        }
    ]
    res.status(200).send(JSON.stringify(data));
});

exports.handleParticipantsInvite = functions.https.onRequest((req,res) => {
    let inviter = req.body.inviter;
    let meetId = req.body.meetId;
    let inviteList = req.body.inviteList;
    var meetRef = firestoreDb.collection('Meets').doc(meetId);
    return meetRef.get().then(doc => {
        if (!doc.exists) {
            //console.log('No such document!');
            res.status(500).send('error');
        } else {
            //console.log('Document data:', doc.data());
            var meet = doc.data();

            let status = meet.status;
            let selectedListObj;
            if(status){
                selectedListObj=meet.selectedFriendsList;
            } else{
                selectedListObj = meet.backupSelectedFriendsList;
            }
            let selectedUidList = Object.keys(selectedListObj);
            inviteList.map((uid) => {
                let uidObj = selectedListObj[uid];
                //let invitedByCreator;
                if(uidObj && !uidObj.invitedBy){
                    //invitedByCreator = true;
                } else {
                    //invitedByCreator = false;
                    if(!uidObj){
                        uidObj = meet.participatingUsersList[meet.creator];
                    }
                    let uidInvitedByList = uidObj.invitedBy;
                    if(!uidInvitedByList){
                        uidInvitedByList=[];
                    }
                    if(!uidInvitedByList.includes(inviter)){
                        uidInvitedByList.push(inviter);
                    }

                    uidObj.invitedBy = uidInvitedByList;
                    selectedListObj[uid]=uidObj;
                }

            });
            if(status){
                return meetRef.update({selectedFriendsList:selectedListObj}).then(()=>{
                    res.status(200).send('ok');
                }).catch((error)=>{
                    res.status(500).send(error);
                });
            } else {
                return meetRef.update({backupSelectedFriendsList:selectedListObj}).then(()=>{
                    res.status(200).send('ok');
                }).catch((error)=>{
                    res.status(500).send(error);
                });
            }


        }
    })
        .catch(err => {
            console.log('Error getting document', err);
            res.status(500).send('error');
        });
});

exports.handleFBAutoAdd = functions.https.onRequest((req,res) => {
    let userUid = req.body.userUid;
    let friendsList = req.body.friends.data;
    let userFacebookId = req.body.facebookId;
    Promise.map(friendsList, (friendInfo) => {
        let friendFacebookId = friendInfo.id;
        let userFriendsListRef = firestoreDb.collection('Users').doc(userUid).collection('Friends_List');
        return userFriendsListRef.where('facebookId','==',friendFacebookId).get().then(snapshot => {
            if(snapshot.size===0){
                initializeFriendShip(friendFacebookId, userUid, userFacebookId);
            }
            console.log(friendFacebookId, snapshot.size===0);
        });

    }).then(()=>res.status(200).send('ok'))
        .catch((error) => {
            console.log(error);
            res.status(500).send(error)
        });
});

