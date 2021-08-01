/*jshint multistr: true */

// ==UserScript==
// @name         Screeps room claim assistant
// @namespace    https://screeps.com/
// @version      0.2.0
// @author       James Cook, thmsn
// @include      https://screeps.com/a/
// @run-at       document-ready
// @require      http://ajax.googleapis.com/ajax/libs/jquery/1.8.3/jquery.min.js
// @require      https://github.com/thmsndk/screeps-browser-ext/raw/master/screeps-browser-core.js
// @downloadUrl  https://github.com/thmsndk/screeps-browser-ext/raw/master/room-claim-assistant.user.js
// @updateURL    https://github.com/thmsndk/screeps-browser-ext/raw/master/room-claim-assistant.user.js
// ==/UserScript==

let roomObjectCounts = {};
function getRoomObjectCounts(shardName, roomName, callback) {
  let scope = angular.element(document.body).scope();
  if (roomObjectCounts[roomName]) {
    callback(roomObjectCounts[roomName]);
  } else {
    //console.log("Bind socket event", roomName)
    let eventFunc = ScreepsAdapter.Socket.bindEventToScope(
      scope,
      `roomMap2:${shardName}/${roomName}`,
      function (objectCounts) {
        roomObjectCounts[roomName] = objectCounts;
        eventFunc.remove();
        // console.log("Data loaded", roomName);
        callback(objectCounts);
      }
    );
  }
}

var interceptingApiPost = false;
function interceptClaim0StatsRequest() {
  if (interceptingApiPost) return;
  interceptingApiPost = true;

  let api = ScreepsAdapter.Api;
  let post = api.post;
  api.post = (uri, body) => {
    //console.log("interceptClaim0StatsRequest", uri, body);
    if (uri === "game/map-stats" && (body.statName === "claim0" || body.statName === "owner0")) {
      body.statName = "minerals0";
    }
    return post(uri, body);
  };
}
// TODO: there seem to be an issue when it refreshes map stats?
let zoomLevel;
function recalculateClaimOverlay() {
  // $(".room-prohibited").hide();

  // console.log("recalculateClaimOverlay");
  let user = angular.element(document.body).scope().Me();
  let mapContainerElem = angular.element($(".map-container"));
  let worldMap = mapContainerElem.scope().WorldMap;

  // const claimAssistContainersToClear = $(mapContainerElem).find(`.claim-assist-container`);
  // console.log(`clearing ${claimAssistContainersToClear.length} claim assist containers due to new zoom level`);
  // claimAssistContainersToClear.remove();

  let mapSectors = $(`.map-sector.map-sector--zoom${worldMap.zoom}`);
  // console.log("mapSectors", mapSectors.length, mapSectors);
  for (let i = 0; i < mapSectors.length; i++) {
    let sectorElem = angular.element(mapSectors[i]);
    let scope = sectorElem.scope();
    // console.log(scope);
    let sector = scope.$parent.sector; // at zoomlevel 2, a sector seems to contain ~16 rooms delmited by a comma
    // console.log(sector.rooms); // at zoomlevel 3 there is no .rooms
    // let sectorRoomName = sector.name;
    // console.log(sector.name);
    // console.log(sectorElem);

    const rooms = worldMap.zoom != 3 ? sector.rooms.split(",") : [sector.name];
    // console.log(sector.name, rooms);

    // add sector info container
    let claimAssistSectorContainer = $(sectorElem).find(`.claim-assist-container[room="${sector.name}"]`);
    if (!claimAssistSectorContainer.length) {
      claimAssistSectorContainer = $("<div></div>");
      claimAssistSectorContainer.attr("class", `claim-assist-container`);
      claimAssistSectorContainer.attr("room", sector.name);
      // console.log("appending claim assist div");
      $(sectorElem).append(claimAssistSectorContainer);
    }

    for (const roomName of rooms) {
      if (roomName) {
        let claimAssistDiv = $(claimAssistSectorContainer).find(`.claim-assist[room="${roomName}"]`);
        if (!claimAssistDiv.length) {
          claimAssistDiv = $("<div></div>");
          claimAssistDiv.attr("room", roomName);
          // console.log("appending claim assist div");
          $(claimAssistSectorContainer).append(claimAssistDiv);
        }

        let roomStats = worldMap.roomStats[roomName];
        if (!roomStats || roomStats.status === "out of borders") {
          // can't get the room objects for this, don't bother rendering anything
          continue;
        }

        getRoomObjectCounts(worldMap.shard, roomName, (counts) => {
          if (!counts) return;
          if (!counts.s) {
            console.log("Bad object list for", roomName, counts);
            return;
          }
          // console.log(counts);

          let userOwned = roomStats.own && roomStats.own.user === user._id;

          // show minerals if:
          let showMinerals =
            (userOwned && roomStats.own.level > 0) || //  user has claimed it OR
            counts.s.length > 1; // it has 2+ sources

          let state = "not-recommended";
          if (userOwned && roomStats.own.level > 0) {
            state = "owned";
          } else if (roomStats.own && !userOwned) {
            state = "prohibited";
          } else if (roomStats.sign && !userOwned && roomStats.sign.user !== user._id) {
            state = "signed";
          } else if (counts.c.length === 0) {
            state = "unclaimable";
          } else if (counts.s.length >= 2 && (!roomStats.own || (userOwned && roomStats.own.level === 0))) {
            // recommend if it has two sources and a controller, nobody else owns it,
            // and user hasn't already claimed
            state = "recommended";
          }

          // let claimRoom = $(claimAssistDiv).attr("room");
          // if (claimRoom !== roomName) {
          if (showMinerals && roomStats.minerals0) {
            claimAssistDiv.html(`
                              <div class='room-mineral-type room-mineral-type-${roomStats.minerals0.type} room-mineral-density-${roomStats.minerals0.density}'>
                                  ${roomStats.minerals0.type}
                              </div>`);
          } else {
            claimAssistDiv.html("");
          }

          claimAssistDiv.attr("class", `room-stats claim-assist ${state}`);
          // }
          // map-float-info
        });
      }
    }
  }
}
/*
<canvas app:game-map-room-objects="shard3/W9S24"
class="room-objects ng-scope" height="150"
map-scale="3" ng:if="WorldMap.displayOptions.units" width="150">
</canvas>
 */
var pendingClaimRedraws = 0;
function bindMapStatsMonitor() {
  let mapContainerElem = angular.element(".map-container");
  let scope = mapContainerElem.scope();
  let worldMap = scope.WorldMap;

  let deferRecalculation = function () {
    $(".claim-assist").hide();
    $(".claim-assist").remove();

    // console.log(worldMap.displayOptions.layer, worldMap.zoom);
    if (worldMap.displayOptions.layer === "claim0") {
      // the dropdown for selecting "claimable" is only shown at zoom level 3
      if (worldMap.zoom === 3 || worldMap.zoom === 2) {
        // console.log("pendingClaimRedraws", pendingClaimRedraws);
        pendingClaimRedraws++;
        setTimeout(() => {
          pendingClaimRedraws--;
          if (pendingClaimRedraws === 0) {
            recalculateClaimOverlay();
            $(".claim-assist").show();
          }
        }, 500);
      }
    }
  };
  scope.$on("mapSectorsRecalced", deferRecalculation);
  scope.$on("mapStatsUpdated", deferRecalculation);
}
// something wrong with the rendering, we need to render blank spots if we don't
// Entry point
$(document).ready(() => {
  DomHelper.addStyle(`
        .claim-assist { pointer-events: none; }
        .claim-assist.not-recommended { background: rgba(192, 192, 50, 0.3); }
        .claim-assist.recommended { background: rgba(25, 255, 25, 0.2); }
        .claim-assist.owned { background: rgba(50, 50, 255, 0.2); }
        .claim-assist.signed { background: rgba(255, 128, 0, 0.35); }
        .claim-assist.prohibited { background: rgba(255, 50, 50, 0.2); }
        .room-prohibited { display: none; }
        /*.claim-assist-container { display:grid; grid-auto-flow: column; grid-template-rows: repeat(4, 1fr); }*/
        .claim-assist-container {
          display: grid;
          grid-auto-flow: column;
          grid-template-columns: repeat(4, 1fr);
          grid-template-rows: repeat(4, auto);
         }
        .map-sector--zoom2>.claim-assist-container>.claim-assist { width:50px; height:50px; display:block;box-sizing: border-box; }
        .room-stats {
          position: relative;
          left: 0;
          top: 0;
          right: 0;
          bottom: 0;
          z-index: 3;
        }
        .room-stats img {
          border-radius: 100%;
          background: #444;
          border: 3px solid black;
        }
        .room-stats.reserve img {
          opacity: 0.4;
          filter: alpha(opacity=40);
        }
        .room-stats .room-mineral-type {
          border-radius: 100%;
          box-shadow: 0 3px 4px rgba(0, 0, 0, 0.6);
          font-weight: bold;
          position: absolute;
        }
        .map-sector--zoom2 .room-stats .room-mineral-type.room-mineral-density-1 {
          width: 15px;
          height: 15px;
          line-height: 14px;
          border: 3px solid;
          font-size: 8px;
          left: 15px;
          top: 15px;
        }
        .map-sector--zoom2 .room-stats .room-mineral-type.room-mineral-density-2 {
          width: 20px;
          height: 20px;
          line-height: 14px;
          border: 3px solid;
          font-size: 10px;
          left: 15px;
          top: 15px;
        }
        .map-sector--zoom2 .room-stats .room-mineral-type.room-mineral-density-3 {
          width: 25px;
          height: 25px;
          line-height: 24px;
          border: 3px solid;
          font-size: 14px;
          left: 10px;
          top: 10px;
        }
        .map-sector--zoom2 .room-stats .room-mineral-type.room-mineral-density-4 {
          width: 30px;
          height: 30px;
          line-height: 26px;
          border: 3px solid;
          font-size: 16px;
          left: 10px;
          top: 10px;
        }
        .room-stats .room-mineral-type.room-mineral-type-L {
          color: #89F4A5;
          background-color: #3F6147;
          border-color: #89F4A5;
        }
        .room-stats .room-mineral-type.room-mineral-type-U {
          color: #88D6F7;
          background-color: #1B617F;
          border-color: #88D6F7;
        }
        .room-stats .room-mineral-type.room-mineral-type-K {
          color: #9370FF;
          background-color: #331A80;
          border-color: #9370FF;
        }
        .room-stats .room-mineral-type.room-mineral-type-Z {
          color: #F2D28B;
          background-color: #594D33;
          border-color: #F2D28B;
        }
        .room-stats .room-mineral-type.room-mineral-type-X {
          color: #FF7A7A;
          background-color: #4F2626;
          border-color: #FF7A7A;
        }
        .room-stats .room-mineral-type.room-mineral-type-H {
          color: #CCCCCC;
          background-color: #4D4D4D;
          border-color: #CCCCCC;
        }
        .room-stats .room-mineral-type.room-mineral-type-O {
          color: #CCCCCC;
          background-color: #4D4D4D;
          border-color: #CCCCCC;
        }

    `);

  // we need this timeout to let scopes and such initialize
  setTimeout(() => {
    ScreepsAdapter.onViewChange(function (view) {
      console.log("onViewChange");
      if (view === "worldMapEntered") {
        interceptClaim0StatsRequest();
        ScreepsAdapter.$timeout(bindMapStatsMonitor);
      }
    });
  }, 100);
});
